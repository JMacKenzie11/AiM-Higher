"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { logCoachTokenUsage } from "./usage";
import {
  applyNeverWrittenFilter,
  parseMemoryResponse,
  MAX_MEMORIES_PER_CONVERSATION,
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
// ---- GENERAL MODE ONLY -------------------------------------------
//
// `about` conversations produce no memory. The write path attaches
// memory to auth.uid() — the PARTICIPANT — so an about-mode
// conversation would write a leader's characterisations of a report
// into the LEADER's memory. That is the safe direction, and it is
// still not a thing to build by default: it would be durable
// third-party notes about someone who never consented to the record.
// See docs/product-spec.md, where the reasoning is recorded so that
// adding about-mode later reopens at that paragraph rather than
// starting from scratch.

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
    .select("id, updated_at")
    .eq("created_by", session.profile.id)
    .eq("mode", "general")
    .order("updated_at", { ascending: false })
    .limit(MAX_PER_RUN + 1);
  if (openConversationId) query = query.neq("id", openConversationId);

  const { data: convoRows } = await query;
  const candidates = (convoRows ?? []) as Array<{
    id: string;
    updated_at: string;
  }>;
  if (candidates.length === 0) {
    return { ok: true, conversationsSummarized: 0, memoriesWritten: 0, droppedByFilter: 0 };
  }

  // THE WATERMARK, without a schema change. Part 1 is deployed, so a
  // column would cost a migration; conversation_ref + created_at
  // already carry what is needed.
  //
  // KNOWN IMPRECISION, named rather than hidden: created_at is when
  // the SUMMARY was written, not when the last covered message
  // arrived. A message landing between reading the transcript and
  // writing the memory is skipped. The window is a single request,
  // and the next trigger picks it up — the cost of closing it
  // properly is a column on the platform's most sensitive table.
  const { data: markRows } = await supabase
    .from("coach_memories")
    .select("conversation_ref, created_at")
    .eq("profile_id", session.profile.id)
    .in("conversation_ref", candidates.map((c) => c.id))
    .order("created_at", { ascending: false });
  const watermark = new Map<string, string>();
  for (const row of (markRows ?? []) as Array<{
    conversation_ref: string | null;
    created_at: string;
  }>) {
    if (row.conversation_ref && !watermark.has(row.conversation_ref)) {
      watermark.set(row.conversation_ref, row.created_at);
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Not an error the caller should see: the page is rendering and
    // memory is an enhancement. Log and move on.
    console.warn("coach memory: ANTHROPIC_API_KEY not set; skipping");
    return { ok: true, conversationsSummarized: 0, memoriesWritten: 0, droppedByFilter: 0 };
  }

  const systemPrompt = await readFile(PROMPT_PATH, "utf8");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  let summarized = 0;
  let written = 0;
  let dropped = 0;

  for (const convo of candidates.slice(0, MAX_PER_RUN)) {
    const since = watermark.get(convo.id);
    // Nothing new since the last summary. Top-up semantics: resuming
    // a summarized thread and continuing produces another memory on
    // the next entry, not a duplicate of the first.
    if (since && convo.updated_at <= since) continue;

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
    }>;
    const userTurns = messages.filter((m) => m.role === "user").length;
    if (userTurns < MIN_USER_TURNS) continue;

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
            content: `Distil this finished coaching conversation.\n\n${transcript}`,
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
        continue;
      }
      written += 1;
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
