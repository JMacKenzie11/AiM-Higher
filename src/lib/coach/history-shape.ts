// Pure derivations behind the coach's history tools.
//
// Separated from the tools themselves for the same reason
// lib/issues/thread.ts is separate from IssueCard: the vitest
// environment is `node` with no DOM and no database, so the choice is
// between testing this by mocking a query builder and testing it by
// calling it. Everything here is a function of rows already fetched.

export type CompletionTiming =
  | "early"
  | "on_time"
  | "late_in_week"
  | "late"
  | "unknown";

export type TimedCommitment = {
  status: string;
  due_date: string | null;
  week_ending: string | null;
  completed_at: string | null;
};

// WHEN, relative to the two dates a commitment carries.
//
// A commitment has a due_date (the day it was promised for) and a
// week_ending (the Friday of the week it belongs to). Those are
// usually but not always the same day, and the gap between them is
// the interesting part: work that landed after the due date but
// before the week closed still landed inside the rhythm, and reading
// it as simply "late" loses the distinction between someone who
// slipped a day and someone who slipped the week.
//
//   early         — completed before the due date
//   on_time       — completed on the due date
//   late_in_week  — after the due date, on or before the week's Friday
//   late          — after the week closed
//   unknown       — no completed_at, or no due date to compare against
//
// Deliberately NOT derived from `status`. kept_on_time and kept_late
// are decided at resolution time against the due date alone; this is
// a finer reading of the same event and the two can disagree, which
// is a fact about the row rather than a bug.
export function completionTiming(row: TimedCommitment): CompletionTiming {
  const done = row.completed_at?.slice(0, 10);
  if (!done || !row.due_date) return "unknown";
  if (done < row.due_date) return "early";
  if (done === row.due_date) return "on_time";
  if (row.week_ending && done <= row.week_ending) return "late_in_week";
  return "late";
}

export type QuarterWindow = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
};

// A commitment belongs to the quarter its WEEK falls in, matching
// computeQuarterKeepRateForSubject in context.ts. Using due_date
// instead would move a rescheduled commitment between quarters
// retroactively and make a closed quarter's rate change after the
// fact.
export function quarterOf(
  row: { week_ending: string | null },
  quarters: readonly QuarterWindow[]
): QuarterWindow | null {
  const wk = row.week_ending;
  if (!wk) return null;
  return (
    quarters.find((q) => wk >= q.start_date && wk <= q.end_date) ?? null
  );
}

export type QuarterTimingCounts = {
  early: number;
  on_time: number;
  late_in_week: number;
  late: number;
  unknown: number;
};

export type QuarterHistory = {
  quarter_label: string;
  kept_on_time: number;
  kept_late: number;
  missed: number;
  // kept (either kind) ÷ all resolved. Null when the quarter resolved
  // nothing — NOT zero, which would read as "failed everything".
  follow_through_pct: number | null;
  timing: QuarterTimingCounts;
};

const KEPT = new Set(["kept_on_time", "kept_late"]);

export function summarizeQuarter(
  label: string,
  rows: readonly TimedCommitment[]
): QuarterHistory {
  const timing: QuarterTimingCounts = {
    early: 0,
    on_time: 0,
    late_in_week: 0,
    late: 0,
    unknown: 0,
  };
  let keptOnTime = 0;
  let keptLate = 0;
  let missed = 0;

  for (const row of rows) {
    if (row.status === "kept_on_time") keptOnTime++;
    else if (row.status === "kept_late") keptLate++;
    else if (row.status === "missed") missed++;
    if (KEPT.has(row.status)) timing[completionTiming(row)]++;
  }

  const resolved = keptOnTime + keptLate + missed;
  return {
    quarter_label: label,
    kept_on_time: keptOnTime,
    kept_late: keptLate,
    missed,
    follow_through_pct:
      resolved === 0
        ? null
        : Math.round(((keptOnTime + keptLate) / resolved) * 100),
    timing,
  };
}

// Is the current quarter unusual FOR THIS PERSON, against their own
// prior quarters rather than against the company or a fixed bar.
//
// Returns null rather than a verdict when there is not enough to
// compare — fewer than two prior quarters carrying a rate, or a
// current quarter that has resolved nothing yet. The coach's
// provenance rule turns on this: "thin record, say so" needs a
// machine-readable way to know the record is thin, not a judgement
// call made by a language model looking at two numbers.
export type BaselineComparison = {
  current_pct: number;
  baseline_pct: number;
  baseline_quarters: number;
  delta: number;
};

// Takes the minimal shape rather than a QuarterHistory, so the
// person context block can feed it the per-quarter rates it already
// computes instead of assembling a fuller summary it does not use.
export type RatedQuarter = { follow_through_pct: number | null };

export function compareToOwnBaseline(
  current: RatedQuarter,
  prior: readonly RatedQuarter[]
): BaselineComparison | null {
  if (current.follow_through_pct === null) return null;
  const rated = prior
    .map((q) => q.follow_through_pct)
    .filter((p): p is number => p !== null);
  if (rated.length < 2) return null;
  const baseline = Math.round(
    rated.reduce((a, b) => a + b, 0) / rated.length
  );
  return {
    current_pct: current.follow_through_pct,
    baseline_pct: baseline,
    baseline_quarters: rated.length,
    delta: current.follow_through_pct - baseline,
  };
}

// Recurring words across commitment descriptions, as a cheap stand-in
// for "themes". Deliberately shallow: this exists so the person block
// can say "12 open, clustered around hiring and onboarding" in a
// handful of tokens instead of listing twelve descriptions. Anything
// smarter belongs in a tool call the coach makes deliberately, not in
// every conversation's default context.
const STOP = new Set([
  "the","a","an","and","or","to","for","of","in","on","with","by","at","from",
  "is","are","be","was","were","will","would","should","can","could","have",
  "has","had","do","does","did","this","that","these","those","it","its","as",
  "we","i","our","my","their","your","his","her","them","us","you","me","he",
  "she","they","up","out","about","into","over","after","before","get","got",
  "make","made","take","taken","put","set","all","any","each","new","next",
  "week","weekly","day","days","month","time","plan","complete","finish",
]);

export function themesFrom(
  descriptions: readonly string[],
  max = 3
): string[] {
  const counts = new Map<string, number>();
  for (const d of descriptions) {
    const seen = new Set<string>();
    for (const raw of d.toLowerCase().split(/[^a-z0-9']+/)) {
      const w = raw.replace(/^'+|'+$/g, "");
      if (w.length < 4 || STOP.has(w) || seen.has(w)) continue;
      seen.add(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}
