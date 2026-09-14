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
  return { keep: true };
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
