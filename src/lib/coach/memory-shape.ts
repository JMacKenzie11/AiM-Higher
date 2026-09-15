// Pure shaping for coach memory: what the model returned, what is
// safe to keep, and which rows ride in context.
//
// Separated from the action for the reason thread.ts and
// history-shape.ts are separated: vitest runs node-only with no
// database and no model, so the choice is between testing this
// through a mock of the Anthropic client and testing it by calling
// it.

// Provenance, not confidence. Each answers "who put this here".
//   said     - the person stated it in a conversation
//   inferred - the coach concluded it
//   directed - the person asked for it to be kept
export type MemoryKind = "said" | "inferred" | "directed";

export type DraftMemory = { kind: MemoryKind; content: string };

export const MAX_MEMORIES_PER_CONVERSATION = 6;
export const MAX_MEMORY_CHARS = 200;
// Lives here rather than beside the action that enforces it, because
// a "use server" file may export only async functions and the card
// needs this for its maxLength. Same ceiling as a distilled memory:
// one thing worth still knowing, not a note.
export const MAX_DIRECTED_MEMORY_CHARS = 200;

// What the model is asked to return. Parsed defensively: a model that
// returns prose, a fence, a wrong shape or a partial object must
// produce ZERO memories rather than a guess, because a guess here is
// written down permanently under somebody's name.
export function parseMemoryResponse(raw: string): DraftMemory[] {
  const text = stripFence(raw).trim();
  if (!text) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A model that wrapped JSON in a sentence. Take the outermost
    // object and try once more; anything less legible is discarded.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return [];
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return [];
    }
  }

  const list = (parsed as { memories?: unknown })?.memories;
  if (!Array.isArray(list)) return [];

  const out: DraftMemory[] = [];
  for (const item of list) {
    const kind = (item as { kind?: unknown })?.kind;
    const content = (item as { content?: unknown })?.content;
    if (kind !== "said" && kind !== "inferred") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim().slice(0, MAX_MEMORY_CHARS).trim();
    if (trimmed.length === 0) continue;
    out.push({ kind, content: trimmed });
    if (out.length >= MAX_MEMORIES_PER_CONVERSATION) break;
  }
  return out;
}

function stripFence(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fence ? (fence[1] ?? "") : raw;
}

// ---- The never-written filter, as a backstop ------------------
//
// The rules live in prompts/coach-memory.md, where they belong: the
// model is the thing that understands "she mentioned it in passing
// while explaining a missed week". This is the second line, for the
// case where the prompt is followed imperfectly.
//
// DELIBERATELY BLUNT, and it will sometimes drop a memory that was
// fine. That asymmetry is the right one — a lost memory costs the
// coach a little context next time, and a kept one costs a person a
// medical detail sitting permanently in a record about them.
//
// It CANNOT be the only line of defence and is not meant to be: no
// word list catches "has been going through it since the diagnosis"
// without the word. The prompt does that work; this catches the
// obvious misses.

const HEALTH = [
  "diagnos", "cancer", "chemo", "surgery", "surgeries", "hospital",
  "hospice", "therapy", "therapist", "psychiatr", "medication",
  "antidepress", "adhd", "autism", "autistic", "bipolar", "depress",
  "anxiety disorder", "panic attack", "addiction", "alcoholic",
  "rehab", "sober", "miscarriage", "pregnan", "ivf", "fertility",
  "disabilit", "chronic illness", "chronic pain", "long covid",
  "sick leave", "medical leave", "stress leave", "burnout leave",
  "prescription", "treatment for", "in remission", "relapse",
];

const FAMILY = [
  "divorc", "separation from", "custody", "marriage counsel",
  "bereave", "funeral", "passed away", "died", "death of",
  "widow", "affair", "cheating on", "estranged",
  "my kids", "her kids", "his kids", "their kids", "childcare",
  "school run", "maternity", "paternity", "adoption",
  "mortgage", "in debt", "bankrupt", "eviction",
];

// Words that make a family or health word a WORK statement rather
// than a personal one. "Parental leave cover" is a staffing problem;
// "her divorce" is not ours to keep.
const WORK_CONTEXT = [
  "cover", "backfill", "policy", "handover", "rota", "schedule",
  "budget", "headcount", "benefit", "plan for", "process",
];

export type FilterVerdict =
  | { keep: true }
  | { keep: false; reason: "health" | "family" };

export function filterVerdict(content: string): FilterVerdict {
  const text = content.toLowerCase();
  const hasWorkContext = WORK_CONTEXT.some((w) => text.includes(w));

  for (const term of HEALTH) {
    if (text.includes(term)) return { keep: false, reason: "health" };
  }
  // Health is absolute. Family yields to an explicit work framing,
  // which is the narrow exception the prompt describes.
  for (const term of FAMILY) {
    if (text.includes(term) && !hasWorkContext) {
      return { keep: false, reason: "family" };
    }
  }
  // Both lists apply to EVERYONE the conversation mentions, not just
  // the person talking. In an about-mode conversation the team member
  // is the one most likely to be described, and "Marcus is out for
  // surgery" is refused exactly as the participant's own would be.
  // What the leader thinks of Marcus's WORK is kept; what they know
  // about his body is not.
  return { keep: true };
}

// What the person hears when they ask for something the record will
// not keep.
//
// The decline is kind, one sentence about why, and it always offers
// the thing that CAN be kept, because the point is almost never the
// detail itself. Somebody saying "remember my dad is in hospital
// until October" is telling you they will be stretched until October,
// and that part is ordinary work context worth having.
//
// A refusal with no alternative reads as the product being squeamish.
// A refusal with one reads as the product knowing the difference
// between what helps and what is nobody's business.
export function declineMessageFor(reason: "health" | "family"): string {
  if (reason === "health") {
    return (
      "I don't keep anything about health or medical matters, yours or " +
      "anyone else's, so I haven't saved that. If it would help, I can " +
      "note the work side instead: that you're going to be stretched, " +
      "and until when, with no reason attached."
    );
  }
  return (
    "I don't keep notes about family or personal life, so I haven't " +
    "saved that. If it's shaping something at work, I can keep that " +
    "part instead: the commitment that's moving, or the stretch you're " +
    "expecting, without the personal detail."
  );
}

export type FilterResult = {
  kept: DraftMemory[];
  dropped: Array<{ memory: DraftMemory; reason: "health" | "family" }>;
};

export function applyNeverWrittenFilter(
  drafts: readonly DraftMemory[]
): FilterResult {
  const kept: DraftMemory[] = [];
  const dropped: FilterResult["dropped"] = [];
  for (const m of drafts) {
    const verdict = filterVerdict(m.content);
    if (verdict.keep) kept.push(m);
    else dropped.push({ memory: m, reason: verdict.reason });
  }
  return { kept, dropped };
}

// ---- What rides in context ------------------------------------

export type StoredMemory = {
  id: string;
  kind: MemoryKind;
  content: string;
  created_at: string;
};

export const CONTEXT_MEMORY_LIMIT = 12;
export const CONTEXT_MEMORY_DAYS = 120;

// Recency-weighted, capped, with older memories falling out of the
// default block rather than being deleted — memory_lookup still
// reaches them.
//
// Weighting is by age band rather than a continuous decay: a
// continuous score invites the reader to believe the ordering means
// more than it does. Three bands say what is actually known — this
// is recent, this is a while back, this is old — and inside a band
// the newest wins.
// How many of the block's slots pinned memories may occupy before the
// oldest of them starts falling out.
//
// THE OVERFLOW RULE, which needs stating because "always included"
// and "inside the same token budget" cannot both hold forever. A
// person who pins thirty things would otherwise either blow the
// budget or push every distilled memory out of the block, and the
// coach would arrive knowing thirty instructions and nothing about
// the conversation they are in.
//
// So: pinned memories are exempt from the RECENCY fade, not from the
// budget. They take the front of the block, newest first, up to this
// share of it. Past that, the OLDEST pinned rows fall back to being
// tool-reachable through memory_lookup, exactly as an old distilled
// memory does. Newest-wins rather than oldest-wins because a person
// who keeps pinning is telling you what matters now, and the thing
// they pinned two years ago has had its chance to be acted on.
//
// The card says which ones are actively carried, so this is visible
// rather than silent — a person who pins a thirteenth thing and
// quietly loses the first would have no way to know.
export const CONTEXT_PINNED_SHARE = 0.75;

export function pinnedCarryLimit(limit: number = CONTEXT_MEMORY_LIMIT): number {
  return Math.max(1, Math.floor(limit * CONTEXT_PINNED_SHARE));
}

export function selectForContext(
  memories: readonly StoredMemory[],
  nowIso: string,
  limit: number = CONTEXT_MEMORY_LIMIT,
  // Ids to place ahead of everything else, whatever their age band.
  // In about mode these are the memories from prior conversations
  // about the SAME person, which is the continuity the leader is
  // actually sitting down for: "last time we talked about Marcus".
  // A leader who coaches about six people would otherwise see this
  // person's thread crowded out by five other people's, purely on
  // recency, and the block would get less useful the more they used
  // the product.
  //
  // Priority reorders. It does NOT widen: the age window and the
  // limit both still apply, so this cannot be used to smuggle more
  // into the block than the budget allows.
  priorityIds: ReadonlySet<string> = new Set()
): StoredMemory[] {
  const now = Date.parse(nowIso);
  const age = (m: StoredMemory) =>
    (now - Date.parse(m.created_at)) / 86_400_000;

  // PINNED FIRST, and exempt from the age window. A person who asked
  // for something to be remembered did not ask for four months of it.
  const pinned = memories
    .filter((m) => m.kind === "directed")
    .sort((a, b) => age(a) - age(b))
    .slice(0, pinnedCarryLimit(limit));

  const rest = memories
    .filter((m) => m.kind !== "directed")
    .map((m) => ({ m, ageDays: age(m), priority: priorityIds.has(m.id) ? 0 : 1 }))
    // Older than the window drops out of the DEFAULT block. Still in
    // the table, still reachable by tool, deliberately not free.
    .filter((s) => s.ageDays <= CONTEXT_MEMORY_DAYS)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const band = ageBand(a.ageDays) - ageBand(b.ageDays);
      if (band !== 0) return band;
      return a.ageDays - b.ageDays;
    })
    .map((s) => s.m);

  return [...pinned, ...rest].slice(0, limit);
}

function ageBand(days: number): number {
  if (days <= 14) return 0;
  if (days <= 45) return 1;
  return 2;
}

export function formatMemoryBlock(
  memories: readonly StoredMemory[],
  nowIso: string
): string {
  if (memories.length === 0) return "";
  const lines = ["<coach_memory>"];
  lines.push(
    "What you remember about this person from previous conversations. " +
      "These are RECALL, not facts about them — see the provenance rules."
  );
  lines.push("");
  for (const m of memories) {
    const age = relativeAge(m.created_at, nowIso);
    // `directed` is labelled with what it actually is, because the
    // coach voices it differently: it is not something distilled from
    // a conversation, it is an instruction the person left for you.
    const tag =
      m.kind === "directed" ? "directed - they asked you to remember this" : m.kind;
    lines.push(`- [${tag}] ${m.content} (${age})`);
  }
  lines.push("</coach_memory>");
  return lines.join("\n");
}

function relativeAge(createdAt: string, nowIso: string): string {
  const days = Math.max(
    0,
    Math.round((Date.parse(nowIso) - Date.parse(createdAt)) / 86_400_000)
  );
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

// ---- Which conversations a sweep actually works on ---------------
//
// Extracted and made pure because the first version of this lived
// inline in the action as "take the newest MAX_PER_RUN + 1, skip the
// thin ones", and that shape deadlocked in production.
//
// The failure: a conversation with fewer than MIN_USER_TURNS was
// skipped by a `continue` that jumped past the watermark update, so
// it was never marked as seen. An empty conversation, of which
// /ask-aimee/new leaves one behind every time somebody opens a thread
// and backs out, therefore stayed a candidate forever AND stayed at
// the head of the queue, because ordering is by updated_at. With a
// window of only four, three empty conversations at the head meant
// every sweep examined the same three, skipped all three, and
// returned nothing. The owner's real conversations sat at positions
// seven and eight with nine and ten user turns and were never once
// reached.
//
// The fix separates two things the old code conflated: how many
// conversations we LOOK at, and how many we spend a model call on.
// Failure mode E9.
// Looking is cheap and must range far enough to get past any run of
// unusable rows. Summarizing is expensive and stays capped.
//
// A thin conversation is still not summarized. It just no longer
// blocks the ones behind it.

export type SweepCandidate = {
  id: string;
  updated_at: string;
  memory_summarized_through: string | null;
  // The agent this conversation ran, if any. Null for a direct Ask
  // Aimee conversation and for about-mode coaching.
  practice_id?: string | null;
};

// How far down the list we are willing to LOOK. Bounded so that one
// page entry is a predictable amount of work, wide enough that a run
// of empty threads cannot wall off everything behind them.
export const SWEEP_CANDIDATE_WINDOW = 50;

// Generic in the row type so the caller keeps whatever else it
// selected (mode, subject_profile_id). Narrowing to SweepCandidate
// here would force the action to re-look-up fields it already has.
export function selectSweepCandidates<T extends SweepCandidate>(opts: {
  candidates: T[];
  // user-turn count per conversation id, for the whole window
  userTurns: Map<string, number>;
  maxPerRun: number;
  minUserTurns: number;
}): T[] {
  const picked: T[] = [];
  for (const c of opts.candidates) {
    if (picked.length >= opts.maxPerRun) break;
    // AGENT CONVERSATIONS PRODUCE NO MEMORY.
    //
    // A conversation with an agent attached (the Functional Chart
    // Builder, Prepare a Hard Conversation, and the rest) is a person
    // working THROUGH a structured flow, not thinking out loud. What
    // it leaves behind is the artefact the flow produced, which is
    // already saved somewhere better than a memory line, and the
    // person's half of it reads as answers to prompts rather than as
    // anything durable about them.
    //
    // Filtered HERE as well as in the query. The query filter is what
    // does the work; this one is what stops a future edit to the
    // query from quietly reintroducing them, which is exactly how the
    // about-mode exclusion came and went without anybody noticing.
    if (c.practice_id) continue;
    // Already summarized through its latest message. Top-up
    // semantics: it returns as a candidate only when it grows.
    if (c.memory_summarized_through && c.updated_at <= c.memory_summarized_through) {
      continue;
    }
    // An opening line, or an empty shell. Not a thought worth
    // keeping, and critically, no longer a reason to stop looking.
    if ((opts.userTurns.get(c.id) ?? 0) < opts.minUserTurns) continue;
    picked.push(c);
  }
  return picked;
}

// ---- Paging the memory table -----------------------------------
//
// Extracted from the component because the interesting cases are the
// ones a person hits by accident and a screenshot never shows:
// deleting the last row on the last page, and a list that shrinks
// under a page index already past its end.
export const MEMORY_PAGE_SIZE = 10;

export type PageWindow = {
  pageCount: number;
  // The page actually shown, which is not always the one asked for.
  current: number;
  start: number;
  end: number;
  // 1-based, for "11-14 of 14". Zero when there is nothing.
  firstShown: number;
  lastShown: number;
};

export function pageWindow(
  total: number,
  requested: number,
  pageSize: number = MEMORY_PAGE_SIZE
): PageWindow {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // CLAMPED, not trusted. Deleting the last row on page two leaves
  // the index pointing past the end, and an unclamped slice renders
  // an empty table with no control that gets you back.
  const current = Math.min(Math.max(0, requested), pageCount - 1);
  const start = current * pageSize;
  const end = Math.min(total, start + pageSize);
  return {
    pageCount,
    current,
    start,
    end,
    firstShown: total === 0 ? 0 : start + 1,
    lastShown: end,
  };
}
