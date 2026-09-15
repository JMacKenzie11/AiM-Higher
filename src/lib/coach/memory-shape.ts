// Pure shaping for coach memory: what the model returned, what is
// safe to keep, and which rows ride in context.
//
// Separated from the action for the reason thread.ts and
// history-shape.ts are separated: vitest runs node-only with no
// database and no model, so the choice is between testing this
// through a mock of the Anthropic client and testing it by calling
// it.

export type MemoryKind = "said" | "inferred";

export type DraftMemory = { kind: MemoryKind; content: string };

export const MAX_MEMORIES_PER_CONVERSATION = 6;
export const MAX_MEMORY_CHARS = 200;

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

// ---- The about-mode frame rule --------------------------------
//
// An `about` conversation is a leader thinking through someone on
// their team. Its memory is written about the LEADER: what they
// intend, committed to, keep avoiding, decided. The team member may
// appear as context. What must never be written is a claim ABOUT the
// team member, because that is a durable personnel note on somebody
// who never sat in the conversation and never consented to a record.
//
// The team member's actual record is not lost by this. It is live,
// through the tier-one execution tools, every turn. A stale
// characterisation is strictly worse context than the real thing.
//
// This applies ONLY when a subject name is supplied, which is what
// makes it an `about`-mode rule. In general mode a leader reflecting
// on their own patterns may name whoever they like, and
// "Worried that Dana is not ready for the lead role" is exactly the
// personnel thinking the wall exists to make safe to keep.
//
// The discriminator is grammatical position, not sentiment. The
// prompt writes memories in the third person about the leader, so
// "is it about them or about the subject" cannot be settled by
// person. It is settled by whether the subject's name is the thing
// the sentence makes a claim about.

// A word after the name that means the sentence is asserting
// something about them.
const CLAIM_VERBS = new Set([
  "is", "isn't", "isnt", "was", "wasn't", "wasnt", "are", "aren't",
  "seems", "seemed", "appears", "appeared", "feels", "felt",
  "has", "hasn't", "hasnt", "had", "have",
  "can", "can't", "cant", "cannot", "could", "couldn't",
  "won't", "wont", "will", "would", "wouldn't",
  "does", "doesn't", "doesnt", "did", "didn't", "didnt",
  "struggles", "struggled", "lacks", "lacked", "needs", "needed",
  "missed", "misses", "fails", "failed", "refuses", "refused",
  "keeps", "kept", "tends", "tended", "avoids", "avoided",
  "underperforms", "resists", "resisted", "gets", "got",
]);

// A word after the name that means the name is riding along as
// context rather than being the thing claimed about.
const OBLIQUE_FOLLOWERS = new Set([
  "about", "above", "across", "after", "against", "along", "among",
  "around", "as", "at", "before", "behind", "below", "beneath",
  "beside", "between", "beyond", "by", "despite", "down", "during",
  "except", "for", "from", "in", "inside", "into", "near", "of",
  "off", "on", "onto", "out", "outside", "over", "past", "since",
  "than", "through", "to", "toward", "towards", "under", "until",
  "up", "upon", "with", "within", "without",
]);

// A word before the name that opens a clause, which puts the name in
// subject position: "worried THAT Marcus ...", "whether Marcus ...".
const CLAUSE_OPENERS = new Set([
  "that", "whether", "if", "why", "how", "when", "because", "since",
  "although", "though", "but", "and", "or", "so", "while", "unless",
  "until", "before", "after",
]);

function namedInClaimPosition(content: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const after = content.slice(m.index + m[0].length);
    // Possessive: "Marcus's schedule" is the leader's doing, told
    // about Marcus's thing. Context, not a claim.
    if (/^['’]s\b/.test(after)) continue;
    const nextWord = (after.match(/^\s*([A-Za-z']+)/)?.[1] ?? "").toLowerCase();
    // End of sentence or clause: nothing is being claimed.
    if (!nextWord) continue;
    if (CLAIM_VERBS.has(nextWord)) return true;
    if (OBLIQUE_FOLLOWERS.has(nextWord)) continue;

    const before = content.slice(0, m.index);
    const prevWord = (before.match(/([A-Za-z']+)[^A-Za-z']*$/)?.[1] ?? "").toLowerCase();
    // Start of the memory, or the start of a clause, means the name
    // is the grammatical subject of what follows.
    if (!prevWord || CLAUSE_OPENERS.has(prevWord)) return true;
    // Otherwise the name sits after a verb or preposition, as an
    // object: "considering letting Marcus go". The leader is still
    // the one doing the thing.
  }
  return false;
}

export type FilterVerdict =
  | { keep: true }
  | { keep: false; reason: "health" | "family" | "subject_frame" };

export type FilterOptions = {
  // Names of the `about`-mode subject (full and first). Absent in
  // general mode, which is what switches the frame rule off.
  subjectNames?: readonly string[];
};

export function filterVerdict(
  content: string,
  opts: FilterOptions = {}
): FilterVerdict {
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
  // Health and family are checked FIRST and apply to the subject just
  // as absolutely as to the participant: "Marcus is out for surgery"
  // is refused as health before the frame rule ever sees it.
  for (const name of opts.subjectNames ?? []) {
    if (!name.trim()) continue;
    if (namedInClaimPosition(content, name.trim())) {
      return { keep: false, reason: "subject_frame" };
    }
  }
  return { keep: true };
}

export type FilterResult = {
  kept: DraftMemory[];
  dropped: Array<{
    memory: DraftMemory;
    reason: "health" | "family" | "subject_frame";
  }>;
};

export function applyNeverWrittenFilter(
  drafts: readonly DraftMemory[],
  opts: FilterOptions = {}
): FilterResult {
  const kept: DraftMemory[] = [];
  const dropped: FilterResult["dropped"] = [];
  for (const m of drafts) {
    const verdict = filterVerdict(m.content, opts);
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
export function selectForContext(
  memories: readonly StoredMemory[],
  nowIso: string,
  limit: number = CONTEXT_MEMORY_LIMIT
): StoredMemory[] {
  const now = Date.parse(nowIso);
  const scored = memories
    .map((m) => {
      const ageDays = (now - Date.parse(m.created_at)) / 86_400_000;
      return { m, ageDays };
    })
    // Older than the window drops out of the DEFAULT block. Still in
    // the table, still reachable by tool, deliberately not free.
    .filter((s) => s.ageDays <= CONTEXT_MEMORY_DAYS)
    .sort((a, b) => {
      const band = ageBand(a.ageDays) - ageBand(b.ageDays);
      if (band !== 0) return band;
      return a.ageDays - b.ageDays;
    });
  return scored.slice(0, limit).map((s) => s.m);
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
    lines.push(`- [${m.kind}] ${m.content} (${age})`);
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
// Looking is cheap and must range far enough to get past any run of
// unusable rows. Summarizing is expensive and stays capped.
//
// A thin conversation is still not summarized. It just no longer
// blocks the ones behind it.

export type SweepCandidate = {
  id: string;
  updated_at: string;
  memory_summarized_through: string | null;
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
