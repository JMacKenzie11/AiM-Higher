import { describe, it, expect } from "vitest";
import { formatPersonContext } from "./context";
import {
  formatMemoryBlock,
  selectForContext,
  CONTEXT_MEMORY_LIMIT,
  type StoredMemory,
} from "./memory-shape";

// CONTEXT COST BUDGET, enforced rather than measured once.
//
// The person block rides in every turn of every coaching
// conversation, so anything added to it is paid for on every message
// forever. Tier one widened it (six quarters instead of two, an
// own-baseline comparison, the shape of what the person is carrying,
// their open issues), and the brief set a ceiling of roughly 15% of
// context assembly.
//
// Measured against the PERSON BLOCK ALONE, which is the stricter
// test: the block is a fraction of the full assembly (company block,
// strengths block, coaching block, system prompt), so a delta inside
// 15% of the block is necessarily inside 15% of the whole.
//
// Tokens are estimated at 3.7 characters each, which is the usual
// figure for English prose with punctuation and short lines. The
// estimate is not exact and does not need to be — the budget is a
// guard against a block that quietly doubles, not an accounting
// record. Where it matters the number is reported as characters too,
// which is exact.
const CHARS_PER_TOKEN = 3.7;
const tokens = (s: string) => Math.round(s.length / CHARS_PER_TOKEN);

const quarter = (label: string, start: string, end: string) => ({
  id: label,
  company_id: "co_1",
  label,
  start_date: start,
  end_date: end,
  status: "closed" as const,
  created_at: start,
  updated_at: start,
});

// A realistic profile: an operator eighteen months in, carrying a
// dozen things, with a real miss history. Not a worst case and not an
// empty one.
type PersonBlockArgs = Parameters<typeof formatPersonContext>[0];

const REALISTIC: Omit<
  PersonBlockArgs,
  "keepRatesByQuarter" | "baseline" | "openIssues"
> = {
  subject: {
    id: "p_1",
    full_name: "Dana Whitfield",
    position: "VP Operations",
    role: "company_admin" as const,
    company_id: "co_1",
  },
  todayIso: "2026-11-18",
  openQuarter: quarter("Q4 2026", "2026-10-01", "2026-12-31"),
  keptOnTimeCount: 9,
  keptLateCount: 3,
  missedCount: 4,
  parkedCount: 1,
  adminResolvedWithoutReasonCount: 1,
  missed: [
    { description: "Publish the revised onboarding checklist", missed_reason: "Waiting on legal to sign off the contractor clause", week_ending: "2026-11-06", due_date: "2026-11-06", resolved_by_role: "owner" },
    { description: "Close out the Q3 vendor review", missed_reason: "Ran out of week; the pricing call moved twice", week_ending: "2026-10-30", due_date: "2026-10-30", resolved_by_role: "owner" },
    { description: "Hand the dispatch rota to Marcus", missed_reason: "He was out; did not want to drop it on him cold", week_ending: "2026-10-23", due_date: "2026-10-23", resolved_by_role: "owner" },
    { description: "Draft the hiring plan for the second crew", missed_reason: null, week_ending: "2026-10-16", due_date: "2026-10-16", resolved_by_role: "admin" },
  ],
  keptLate: [
    { description: "Run the quarterly safety walkthrough", week_ending: "2026-11-13", due_date: "2026-11-11" },
    { description: "Rebuild the on-call schedule", week_ending: "2026-10-30", due_date: "2026-10-28" },
    { description: "Send the customer escalation summary", week_ending: "2026-10-16", due_date: "2026-10-15" },
  ],
  openCommitments: [
    { description: "Finish the hiring plan for the second crew", due_date: "2026-11-20", week_ending: "2026-11-20" },
    { description: "Interview two dispatch candidates", due_date: "2026-11-20", week_ending: "2026-11-20" },
    { description: "Hiring loop debrief with Marcus", due_date: "2026-11-27", week_ending: "2026-11-27" },
    { description: "Onboarding checklist revision, second pass", due_date: "2026-11-20", week_ending: "2026-11-20" },
    { description: "Onboarding buddy pairing for December starts", due_date: "2026-11-27", week_ending: "2026-11-27" },
    { description: "Vendor pricing comparison sheet", due_date: "2026-11-20", week_ending: "2026-11-20" },
    { description: "Close the open safety action from the walkthrough", due_date: "2026-11-27", week_ending: "2026-11-27" },
    { description: "Rewrite the dispatch escalation path", due_date: "2026-12-04", week_ending: "2026-12-04" },
    { description: "Quarterly review prep pack", due_date: "2026-12-04", week_ending: "2026-12-04" },
    { description: "Sign off the new overtime policy", due_date: "2026-11-27", week_ending: "2026-11-27" },
    { description: "Confirm the December shutdown cover", due_date: "2026-12-11", week_ending: "2026-12-11" },
    { description: "Update the onboarding portal copy", due_date: "2026-12-11", week_ending: "2026-12-11" },
  ],
  priorities: [
    { title: "Second crew fully staffed and productive", status: "on_track" as const },
    { title: "Dispatch escalations under 4 hours", status: "behind" as const },
    { title: "Onboarding to 30 days", status: "on_track" as const },
    { title: "Vendor consolidation", status: "behind" as const },
  ],
  goals: [
    { title: "Double throughput without doubling headcount", status: "on_track" as const },
    { title: "Cut voluntary attrition to under 10%", status: "behind" as const },
  ],
};

const SIX_QUARTERS = [
  { quarter: quarter("Q4 2026", "2026-10-01", "2026-12-31"), keepRate: 71 },
  { quarter: quarter("Q3 2026", "2026-07-01", "2026-09-30"), keepRate: 83 },
  { quarter: quarter("Q2 2026", "2026-04-01", "2026-06-30"), keepRate: 79 },
  { quarter: quarter("Q1 2026", "2026-01-01", "2026-03-31"), keepRate: 88 },
  { quarter: quarter("Q4 2025", "2025-10-01", "2025-12-31"), keepRate: 75 },
  { quarter: quarter("Q3 2025", "2025-07-01", "2025-09-30"), keepRate: 80 },
];

// What the block rendered BEFORE tier one: two quarters, no baseline
// line, no carrying shape, no open issues.
const before = formatPersonContext({
  ...REALISTIC,
  keepRatesByQuarter: SIX_QUARTERS.slice(0, 2),
  baseline: null,
  openIssues: [],
});

const after = formatPersonContext({
  ...REALISTIC,
  keepRatesByQuarter: SIX_QUARTERS,
  baseline: {
    current_pct: 71,
    baseline_pct: 81,
    baseline_quarters: 5,
    delta: -10,
  },
  openIssues: [
    { title: "Dispatch escalations take too long to route", attempts: 3 },
    { title: "New starters idle in week one", attempts: 2 },
    { title: "Vendor invoices arrive after the close", attempts: 4 },
  ],
});

describe("widened person block stays inside its context budget", () => {
  it("adds less than 15% to the block it widens", () => {
    const grew = tokens(after) - tokens(before);
    const pct = (grew / tokens(before)) * 100;
    // Reported so a failure says what it cost, not just that it did.
    console.info(
      `person block: ${before.length} chars (~${tokens(before)} tok) → ` +
        `${after.length} chars (~${tokens(after)} tok); ` +
        `+${grew} tok, +${pct.toFixed(1)}%`
    );
    expect(pct).toBeLessThan(15);
  });

  it("carries the four things tier one added", () => {
    // A budget test that passed because the feature silently stopped
    // rendering would be worse than no test.
    expect(after).toContain("their own baseline");
    expect(after).toContain("Currently carrying 12 open commitments");
    expect(after).toContain("clustered around");
    expect(after).toContain("Open issues they are carrying");
    expect(after).toContain("Q3 2025");
  });

  it("says so out loud when the record is too thin to compare", () => {
    const thin = formatPersonContext({
      ...REALISTIC,
      keepRatesByQuarter: SIX_QUARTERS.slice(0, 1),
      baseline: null,
      openIssues: [],
    });
    expect(thin).toContain("not enough history to compare");
    expect(thin).toContain("Do not infer a trend");
  });
});


// ---- Coach memory block --------------------------------------
//
// Same budget discipline as the person block above, for the same
// reason: this rides in every turn of every general-mode
// conversation, so anything added is paid for on every message
// forever.
//
// Measured against the person block, which is the block it sits
// beside and a fair comparator for "is this a reasonable share of
// context". The ceiling is the same 15%.
const memoryAt = (days: number, content: string): StoredMemory => ({
  id: `m${days}`,
  kind: days % 2 === 0 ? "said" : "inferred",
  content,
  created_at: new Date(
    Date.parse("2026-11-18T12:00:00Z") - days * 86_400_000
  ).toISOString(),
});

// A person a few months into using the coach: more memories than the
// block will show, so the cap is doing real work.
const REALISTIC_MEMORIES: StoredMemory[] = [
  memoryAt(2, "Wants to hand the Thursday dispatch run to Marcus before the quarter closes"),
  memoryAt(4, "Finds the weekly leadership meeting frustrating and has for months"),
  memoryAt(9, "Is weighing whether Dana is ready to lead the second crew"),
  memoryAt(12, "Leaves the hard conversations until the end of the week"),
  memoryAt(16, "Decided to keep vendor consolidation in-house rather than bring in a consultant"),
  memoryAt(21, "Tried a written agenda for the ops meeting and it did not stick"),
  memoryAt(28, "Wants to cut travel substantially next quarter"),
  memoryAt(35, "Doubts the second ops hire was the right call"),
  memoryAt(44, "Plans to restructure dispatch under one manager by Q1"),
  memoryAt(52, "Keeps meaning to write the onboarding checklist and has not"),
  memoryAt(70, "Said the escalation path is the thing that wakes him up at night"),
  memoryAt(88, "Promoted Priya and thinks it went better than expected"),
  memoryAt(110, "Has been trying to run fewer, longer one-to-ones"),
  memoryAt(140, "Older than the window; must not appear in the default block"),
  memoryAt(200, "Much older; reachable by memory_lookup, not free in context"),
];

describe("coach memory block stays inside its context budget", () => {
  const NOW = "2026-11-18T12:00:00Z";
  const picked = selectForContext(REALISTIC_MEMORIES, NOW);
  const block = formatMemoryBlock(picked, NOW);

  it("costs less than 15% of context assembly", async () => {
    // AGAINST ASSEMBLY, not against the person block.
    //
    // The person block's gate compares a widening to the thing it
    // widened, which is the right question there. This is a NEW
    // block, so the question is what share of the whole it takes —
    // and the honest denominator is the fixed cost every turn already
    // pays: the composed system prompt plus the person block.
    //
    // Reported both ways, because the smaller number is the one a
    // favourable denominator would be hiding behind.
    const { promises: fs } = await import("node:fs");
    const path = (await import("node:path")).default;
    const root = process.cwd();
    const [remainder, voice] = await Promise.all([
      fs.readFile(path.join(root, "prompts", "leadership-coach.md"), "utf8"),
      fs.readFile(path.join(root, "prompts", "aims-voice.md"), "utf8"),
    ]);
    const systemPrompt = remainder.replace("{{AIMS_VOICE}}", voice);
    const assembly = tokens(systemPrompt) + tokens(after);
    const pctAssembly = (tokens(block) / assembly) * 100;
    const pctPerson = (tokens(block) / tokens(after)) * 100;

    console.info(
      `memory block: ${block.length} chars (~${tokens(block)} tok), ` +
        `${picked.length} of ${REALISTIC_MEMORIES.length} memories; ` +
        `${pctAssembly.toFixed(1)}% of assembly (~${assembly} tok), ` +
        `${pctPerson.toFixed(1)}% of the person block alone`
    );
    expect(pctAssembly).toBeLessThan(15);
  });

  it("caps the count and drops what is past the window", () => {
    expect(picked.length).toBeLessThanOrEqual(CONTEXT_MEMORY_LIMIT);
    expect(block).not.toContain("Older than the window");
    expect(block).not.toContain("Much older");
  });

  it("carries the kind label, which the provenance rules turn on", () => {
    // A memory whose kind is lost is a memory the coach cannot know
    // whether to quote or to offer tentatively.
    expect(block).toContain("[said]");
    expect(block).toContain("[inferred]");
  });

  it("costs nothing at all for someone with no memory", () => {
    expect(formatMemoryBlock(selectForContext([], NOW), NOW)).toBe("");
  });
});

// Subject-scoped recall, added with about-mode memory. The gate is
// UNCHANGED and that is the point of measuring: priority reorders the
// block, it does not widen it, so the cost should land on top of the
// unprioritised number rather than above it. A measurement that came
// back materially larger would mean priority had found a way to add
// rows, which is exactly the bug this budget exists to catch.
describe("subject-scoped priority costs nothing extra", () => {
  const NOW = "2026-11-18T12:00:00Z";
  // The leader coaches about several people; these three are the
  // thread about the one in front of them, and two are old enough
  // that recency alone would bury them.
  const SUBJECT_IDS = new Set(["m35", "m44", "m88"]);

  it("measures the same block size with priority applied", async () => {
    const plain = formatMemoryBlock(selectForContext(REALISTIC_MEMORIES, NOW), NOW);
    const scopedPick = selectForContext(
      REALISTIC_MEMORIES,
      NOW,
      CONTEXT_MEMORY_LIMIT,
      SUBJECT_IDS
    );
    const scoped = formatMemoryBlock(scopedPick, NOW);

    const { promises: fs } = await import("node:fs");
    const path = (await import("node:path")).default;
    const root = process.cwd();
    const [remainder, voice] = await Promise.all([
      fs.readFile(path.join(root, "prompts", "leadership-coach.md"), "utf8"),
      fs.readFile(path.join(root, "prompts", "aims-voice.md"), "utf8"),
    ]);
    const systemPrompt = remainder.replace("{{AIMS_VOICE}}", voice);
    const assembly = tokens(systemPrompt) + tokens(after);
    const pct = (tokens(scoped) / assembly) * 100;

    console.info(
      `memory block, subject-scoped: ${scoped.length} chars (~${tokens(scoped)} tok) ` +
        `vs plain ${plain.length} chars (~${tokens(plain)} tok); ` +
        `${pct.toFixed(1)}% of assembly (~${assembly} tok); ` +
        `${scopedPick.length} memories, cap ${CONTEXT_MEMORY_LIMIT}`
    );

    // The gate, unchanged.
    expect(pct).toBeLessThan(15);
    // And the count is identical: reordering, not widening.
    expect(scopedPick.length).toBe(selectForContext(REALISTIC_MEMORIES, NOW).length);
  });

  it("actually front-loads the subject's thread", () => {
    const scopedPick = selectForContext(
      REALISTIC_MEMORIES,
      NOW,
      CONTEXT_MEMORY_LIMIT,
      SUBJECT_IDS
    );
    expect(scopedPick.slice(0, 3).map((m) => m.id).sort()).toEqual(
      ["m35", "m44", "m88"]
    );
    // Without priority, the 88-day-old one is nowhere near the front.
    const plainPick = selectForContext(REALISTIC_MEMORIES, NOW);
    expect(plainPick.slice(0, 3).map((m) => m.id)).not.toContain("m88");
  });
});
