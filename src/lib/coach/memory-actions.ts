"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { logCoachTokenUsage } from "./usage";
import { reportError } from "@/lib/observability/report";
import {
  applyNeverWrittenFilter,
  parseMemoryResponse,
  selectSweepCandidates,
  filterVerdict,
  declineMessageFor,
  MAX_MEMORIES_PER_CONVERSATION,
  MAX_DIRECTED_MEMORY_CHARS,
  SWEEP_CANDIDATE_WINDOW,
} from "./memory-shape";

// Coach memory, the write-after half.
//
// ---- WHEN THIS RUNS, AND WHY THAT SHAPE --------------------------
//
// On entry to any coaching surface, for the caller's conversations
// EXCLUDING the one being opened. Decided against the real lifecycle
// rather than assumed:
//
//   - There is no explicit "close" in this product. `archived` is
//     filing ("tucks a thread out of the way"), not finishing, and
//     most conversations are never archived. It cannot carry the
//     trigger alone.
//   - An inactivity timer would need a cron or queue waking with no
//     session, and the only write path is a definer function that
//     raises when auth.uid() is null. It would force reopening
//     migration 0194 to add a profile_id parameter — and that
//     parameter's ABSENCE is the entire reason the access wall is
//     cheap to trust. Expensive in the one currency this feature
//     cannot spend.
//   - Next-conversation-start runs as the caller, in-request, and the
//     thought is provably finished because they moved on. Widened to
//     any surface entry because RESUMING a thread is a first-class
//     action here, so "started a new one" would miss the common case.
//
// Nothing is ever summarized while it is the conversation in front of
// the person. That is the laziness, and it is deliberate: the cost is
// that the newest conversation is not yet in memory, which is small
// because the coach can read an open conversation's messages directly.
//
// ---- BOTH MODES, IN THE PARTICIPANT FRAME ------------------------
//
// AMENDED 2026-09-14 (ratified, Jason + Jeff). This used to be
// general-mode only, on the reasoning that an about-mode conversation
// would write a leader's characterisations of a report into the
// leader's memory, which is durable third-party notes about somebody
// who never consented to a record. That risk was real and the
// exclusion was the blunt answer to it.
//
// The amendment keeps the risk refused and drops the bluntness. An
// about-mode conversation IS summarized, strictly in the PARTICIPANT
// FRAME: what the leader intends, committed to, keeps avoiding,
// decided. Never a claim about the team member.
//
// Two things enforce that, and they are not the same thing:
//
//   - WHO the row belongs to is structural, from part 1. The write
//     path forces profile_id := auth.uid() and takes no profile
//     parameter, so a memory cannot land on the subject's record even
//     if everything here is wrong.
//   - WHAT the row may say is the frame rule. It lives in
//     prompts/coach-memory.md, with a deterministic backstop in
//     memory-shape.ts that needs the subject's name to see a claim
//     about them, which is why the name is looked up and passed.
//
// The team member's record is not lost by any of this: the coach
// reads it live through the tier-one tools every turn.

const PROMPT_PATH = path.join(process.cwd(), "prompts", "coach-memory.md");
const MODEL = "claude-haiku-4-5";

// How many conversations one entry will summarize. A person returning
// after a long absence should not pay for ten model calls before the
// page renders.
const MAX_PER_RUN = 3;
// Below this, a conversation is an abandoned opening line rather than
// a thought worth keeping.
const MIN_USER_TURNS = 2;
const MAX_TRANSCRIPT_MESSAGES = 60;

export type SummarizeResult = {
  ok: true;
  conversationsSummarized: number;
  memoriesWritten: number;
  droppedByFilter: number;
};

export async function summarizeFinishedConversationsAction(
  openConversationId: string | null
): Promise<SummarizeResult | { ok: false; message: string }> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  // Candidates: the caller's own general-mode conversations, not the
  // one in front of them, most recently touched first.
  let query = supabase
    .from("coaching_conversations")
    .select("id, updated_at, memory_summarized_through, mode, subject_profile_id")
    .eq("created_by", session.profile.id)
    .order("updated_at", { ascending: false })
    // How far we LOOK. Deliberately not MAX_PER_RUN: a run of empty
    // conversations at the head used to wall off everything behind
    // them, because a skipped conversation consumed a slot and was
    // never watermarked. See selectSweepCandidates.
    .limit(SWEEP_CANDIDATE_WINDOW);
  if (openConversationId) query = query.neq("id", openConversationId);

  const { data: convoRows, error: candidateError } = await query;
  if (candidateError) {
    // Was discarded. A refused candidate read is indistinguishable
    // from "nothing to summarize" at every layer above this, which is
    // how a sweep that never ran once looked exactly like a sweep
    // that found nothing worth keeping.
    reportError("coach.memory.candidates", candidateError, {
      profileId: session.profile.id,
    });
  }
  const candidates = (convoRows ?? []) as Array<{
    id: string;
    updated_at: string;
    memory_summarized_through: string | null;
    mode: string;
    subject_profile_id: string | null;
  }>;
  if (candidates.length === 0) {
    return { ok: true, conversationsSummarized: 0, memoriesWritten: 0, droppedByFilter: 0 };
  }

  // THE WATERMARK IS ON THE CONVERSATION, not derived from memory.
  //
  // It used to be the newest memory carrying this conversation_ref,
  // which was wrong in a way only part 3 could expose: delete your
  // memories and the watermark goes with them, so the next sweep
  // reads the conversation from the top and writes the same memories
  // back. Deletion was not durable. See migration 0195.
  //
  // Storing the last message's timestamp rather than "now" also
  // retires the read-write race the old version documented: a message
  // arriving mid-summarization is after the watermark, so the next
  // sweep picks it up instead of skipping it.

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Not an error the caller should see: the page is rendering and
    // memory is an enhancement. Log and move on.
    console.warn("coach memory: ANTHROPIC_API_KEY not set; skipping");
    reportError("coach.memory.no_api_key", new Error("ANTHROPIC_API_KEY not set"), {
      profileId: session.profile.id,
    });
    return { ok: true, conversationsSummarized: 0, memoriesWritten: 0, droppedByFilter: 0 };
  }

  const systemPrompt = await readFile(PROMPT_PATH, "utf8");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  let summarized = 0;
  let written = 0;
  let dropped = 0;

  // User-turn counts for the whole window in ONE query, so that
  // looking past unusable conversations costs a single round trip
  // rather than one per candidate.
  const { data: turnRows, error: turnError } = await supabase
    .from("coaching_messages")
    .select("conversation_id")
    .in("conversation_id", candidates.map((c) => c.id))
    .eq("role", "user");
  if (turnError) {
    reportError("coach.memory.turn_counts", turnError, {
      profileId: session.profile.id,
    });
  }
  const userTurns = new Map<string, number>();
  for (const row of (turnRows ?? []) as Array<{ conversation_id: string }>) {
    userTurns.set(row.conversation_id, (userTurns.get(row.conversation_id) ?? 0) + 1);
  }

  const selected = selectSweepCandidates({
    candidates,
    userTurns,
    maxPerRun: MAX_PER_RUN,
    minUserTurns: MIN_USER_TURNS,
  });

  // Subject names for the about-mode conversations in this run, in
  // one query. The frame rule's backstop can only recognise a claim
  // about somebody it can name, so a missing name means the prompt is
  // the only thing standing between a characterisation and the
  // record. That is worth knowing about rather than shrugging at.
  const subjectIds = [
    ...new Set(
      selected
        .filter((c) => c.mode === "about" && c.subject_profile_id)
        .map((c) => c.subject_profile_id as string)
    ),
  ];
  const subjectNamesById = new Map<string, string[]>();
  if (subjectIds.length > 0) {
    const { data: subjectRows, error: subjectError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", subjectIds);
    if (subjectError) {
      reportError("coach.memory.subject_names", subjectError, {
        profileId: session.profile.id,
      });
    }
    for (const row of (subjectRows ?? []) as Array<{ id: string; full_name: string | null }>) {
      const full = (row.full_name ?? "").trim();
      if (!full) continue;
      const first = full.split(/\s+/)[0];
      // Full name first: the longer match is the more specific one.
      subjectNamesById.set(row.id, first && first !== full ? [full, first] : [full]);
    }
  }

  for (const convo of selected) {
    const since = convo.memory_summarized_through;
    const isAbout = convo.mode === "about";
    const subjectNames = convo.subject_profile_id
      ? subjectNamesById.get(convo.subject_profile_id) ?? []
      : [];
    const subjectName = subjectNames[0] ?? "a person on their team";
    if (isAbout && subjectNames.length === 0) {
      // The backstop is blind for this one. The prompt still applies,
      // but nothing deterministic is behind it, so say so.
      reportError(
        "coach.memory.subject_name_missing",
        new Error("about-mode conversation has no resolvable subject name"),
        { conversationId: convo.id }
      );
    }

    let messageQuery = supabase
      .from("coaching_messages")
      .select("role, content, created_at")
      .eq("conversation_id", convo.id)
      .order("created_at", { ascending: true })
      .limit(MAX_TRANSCRIPT_MESSAGES);
    if (since) messageQuery = messageQuery.gt("created_at", since);

    const { data: msgRows } = await messageQuery;
    const messages = (msgRows ?? []) as Array<{
      role: "user" | "assistant";
      content: string;
      created_at: string;
    }>;
    // Nothing new to read. updated_at can move without a message
    // arriving, and selection works from whole-conversation turn
    // counts, so this is the one case it cannot rule out. Sending an
    // empty transcript to the model would spend a call to summarize
    // nothing.
    if (messages.length === 0) continue;

    // The high-water mark this pass will claim: the last message
    // actually read, not the moment the write happens.
    const readThrough = messages[messages.length - 1]?.created_at ?? null;
    const transcript = messages
      .map((m) => `${m.role === "user" ? "Person" : "Coach"}: ${m.content}`)
      .join("\n\n");

    let drafts;
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: isAbout
              ? `Distil this finished coaching conversation.\n\nThis is an ` +
                `about-mode conversation: a leader thinking through ` +
                `${subjectName}, who is on their team and was not present. ` +
                `Capture both sides: what the leader is working on, and what ` +
                `they observe about ${subjectName}. Anything the leader ` +
                `stated about ${subjectName} is "said", including when the ` +
                `coach questioned it or the record does not corroborate it. ` +
                `Your own reading of ${subjectName} is "inferred".` +
                `\n\n${transcript}`
              : `Distil this finished coaching conversation.\n\n${transcript}`,
          },
        ],
      });
      if (response.usage) {
        void logCoachTokenUsage({
          conversationId: convo.id,
          companyId: session.profile.company_id ?? null,
          purpose: "memory",
          model: MODEL,
          usage: response.usage,
        });
      }
      drafts = parseMemoryResponse(
        response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")
      );
    } catch (err) {
      // One conversation failing must not stop the others, and must
      // not surface to a person who was only opening a page.
      console.error("coach memory: summarization failed", {
        conversationId: convo.id,
        error: err instanceof Error ? err.message : String(err),
      });
      reportError("coach.memory.summarize", err, { conversationId: convo.id });
      continue;
    }

    const { kept, dropped: removed } = applyNeverWrittenFilter(drafts);
    dropped += removed.length;
    if (removed.length > 0) {
      // Counts and reasons only — logging the content would put the
      // thing we refused to store into a log instead.
      console.info("coach memory: filter dropped", {
        conversationId: convo.id,
        reasons: removed.map((r) => r.reason),
      });
    }

    for (const memory of kept.slice(0, MAX_MEMORIES_PER_CONVERSATION)) {
      // THE ONLY WRITE PATH. profile_id is not a parameter: the
      // function forces it to auth.uid(), so this cannot write into
      // anybody else's memory even if this code is wrong.
      const { error } = await supabase.rpc("record_coach_memory", {
        p_kind: memory.kind,
        p_content: memory.content,
        p_conversation_ref: convo.id,
      });
      if (error) {
        console.error("coach memory: write refused", {
          conversationId: convo.id,
          code: error.code,
          message: error.message,
        });
        reportError("coach.memory.write", error, { conversationId: convo.id });
        continue;
      }
      written += 1;
    }
    // Advance the watermark even when the model returned nothing and
    // even when everything was filtered out. A conversation that
    // yielded no durable memory has still been READ, and re-reading
    // it every page load would be a model call per visit forever.
    if (readThrough) {
      const { error: markError } = await supabase
        .from("coaching_conversations")
        .update({ memory_summarized_through: readThrough })
        .eq("id", convo.id);
      if (markError) {
        console.error("coach memory: watermark not advanced", {
          conversationId: convo.id,
          code: markError.code,
        });
        // Worth paging on: a watermark that never advances means this
        // conversation is re-read and re-summarized on every entry,
        // for as long as the refusal lasts.
        reportError("coach.memory.watermark", markError, { conversationId: convo.id });
      }
    }
    summarized += 1;
  }

  return {
    ok: true,
    conversationsSummarized: summarized,
    memoriesWritten: written,
    droppedByFilter: dropped,
  };
}


// Delete the caller's own memories for one conversation.
//
// NARROW ON PURPOSE. Part 3 owns the subject's see-and-delete
// surface; this is not that. It exists because the E2E that proves
// the memory loop writes real rows on the dev clone, and the recorded
// hygiene condition is that the spec cleans up after itself — which
// it cannot do without a path, since there is no in-app delete yet.
//
// It can only ever delete the CALLER'S OWN rows: the DELETE policy on
// coach_memories admits `profile_id = auth.uid()` and nothing else,
// so the filter below is a statement of intent and RLS is the
// boundary. Scoped to one conversation rather than "all mine",
// because a broad delete built for a test is a broad delete somebody
// later calls for a different reason.
// Delete ONE memory. The row-level action behind the trust surface.
//
// Deletion is the person's right, not an admin action: there is no
// role check here because there is no role that may do this on
// somebody else's behalf. RLS admits `profile_id = auth.uid()` on
// DELETE and nothing else, so the eq() below is intent and the policy
// is the boundary.
//
// It writes NO AUDIT TRAIL. Deliberately. A record that Dana deleted
// a memory on Tuesday is itself a fact about Dana that somebody could
// read, and the promise is that nobody but Dana knows what Aimee
// remembers — which has to include knowing what she made Aimee
// forget.
export async function deleteMyMemoryAction(
  memoryId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("coach_memories")
    .delete()
    .eq("id", memoryId)
    .eq("profile_id", session.profile.id)
    .select("id");
  if (error) return { ok: false, message: "Couldn't delete that memory." };
  if ((data ?? []).length === 0) {
    // Not found, or not theirs — the same answer either way, because
    // distinguishing them would confirm that somebody else's memory
    // with that id exists.
    return { ok: false, message: "That memory is no longer there." };
  }
  return { ok: true };
}

// Read the caller's own memory for the trust surface, newest first,
// with the conversation each arose in so the page can link to it.
// ---- Person-added memory ---------------------------------------
//
// The person hands the record a line and asks for it back later.
// Written through the SAME definer path as everything else, which is
// the point: there is still no way to spell "write this into
// somebody else's memory", and adding a second write path would have
// been the easy way to lose that.
//
// The never-written list applies to an explicit ask exactly as it
// applies to a distilled one. That is a deliberate decision and not
// an oversight: a person asking Aimee to hold a medical fact is
// asking her to be a place that medical facts live, and this is not
// that place. She declines, says why in a sentence, and offers the
// work-shaped version she can keep.
export type AddMemoryResult =
  | { ok: true; id: string }
  | { ok: false; declined: true; message: string }
  | { ok: false; declined?: false; message: string };

export async function addDirectedMemoryAction(
  content: string
): Promise<AddMemoryResult> {
  const session = await requireProfile();
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Nothing to save." };
  }
  if (trimmed.length > MAX_DIRECTED_MEMORY_CHARS) {
    return {
      ok: false,
      message: `Keep it under ${MAX_DIRECTED_MEMORY_CHARS} characters. A memory is one thing worth still knowing, not a note.`,
    };
  }

  const verdict = filterVerdict(trimmed);
  if (!verdict.keep) {
    return { ok: false, declined: true, message: declineMessageFor(verdict.reason) };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase.rpc("record_coach_memory", {
    p_kind: "directed",
    p_content: trimmed,
    p_conversation_ref: null,
  });
  if (error) {
    reportError("coach.memory.add_directed", error, {
      profileId: session.profile.id,
    });
    return { ok: false, message: "Couldn't save that just now. Try again in a moment." };
  }
  return { ok: true, id: data as string };
}

export type MemoryListRow = {
  id: string;
  kind: "said" | "inferred";
  content: string;
  created_at: string;
  conversation_ref: string | null;
  conversation_title: string | null;
};

export type MemoryListResult = {
  rows: MemoryListRow[];
  // A refused or failed read, as distinct from an empty one. The page
  // MUST NOT render "Aimee hasn't noted anything yet" on this, because
  // that sentence claims the memory is empty when we do not know.
  readFailed: boolean;
};

export async function listMyMemoriesAction(): Promise<MemoryListResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error: readError } = await supabase
    .from("coach_memories")
    .select(
      "id, kind, content, created_at, conversation_ref, coaching_conversations(title)"
    )
    .eq("profile_id", session.profile.id)
    .order("created_at", { ascending: false });
  if (readError) {
    reportError("coach.memory.list", readError, { profileId: session.profile.id });
  }
  const rows = ((data ?? []) as Array<{
    id: string;
    kind: "said" | "inferred";
    content: string;
    created_at: string;
    conversation_ref: string | null;
    coaching_conversations: { title: string } | { title: string }[] | null;
  }>).map((r) => {
    const convo = Array.isArray(r.coaching_conversations)
      ? r.coaching_conversations[0]
      : r.coaching_conversations;
    return {
      id: r.id,
      kind: r.kind,
      content: r.content,
      created_at: r.created_at,
      conversation_ref: r.conversation_ref,
      conversation_title: convo?.title ?? null,
    };
  });
  return { rows, readFailed: Boolean(readError) };
}

// Delete ALL of the caller's own memory.
//
// Not a test affordance and not a broad hammer: "you can see and
// delete any of it" is the promise part 3 publishes,
// and this is that. RLS bounds it to the caller absolutely — the
// DELETE policy admits `profile_id = auth.uid()` and nothing else, so
// there is no argument, header or bug that reaches another person's
// memory.
//
// The E2E needs it because cleaning up "what this run created" is not
// enough: the trigger under test deliberately summarizes OTHER
// conversations, so a run writes memory for threads left by earlier
// runs. Leaving the fixture's memory as it found it — empty — is the
// only cleanup that actually holds.
export async function deleteAllMyMemoriesAction(): Promise<
  { ok: true; deleted: number } | { ok: false; message: string }
> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("coach_memories")
    .delete()
    .eq("profile_id", session.profile.id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  return { ok: true, deleted: (data ?? []).length };
}

export async function deleteMyMemoriesForConversationAction(
  conversationId: string
): Promise<{ ok: true; deleted: number } | { ok: false; message: string }> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("coach_memories")
    .delete()
    .eq("conversation_ref", conversationId)
    .eq("profile_id", session.profile.id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  return { ok: true, deleted: (data ?? []).length };
}
