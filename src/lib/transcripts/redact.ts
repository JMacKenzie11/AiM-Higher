import { removePersonalDetail, type PersonalDetailMatcher } from "@/lib/voice/personal-detail";
import type { CoverageReport } from "./coverage";

// WHAT THE PRIVATE-LIFE RULE DOES TO A STORED MEETING ANALYSIS.
//
// One function, used in two places, so they cannot disagree:
//
//   analyze.ts, at the write: every pass has run on the full data
//     (coverage compares against every extracted commitment), and the
//     rule is applied once to the row about to be stored.
//   scripts/propose-summary-redactions.ts: the same function over rows
//     stored before the rule existed, to propose what would change.
//
// Prose (the summary, the facilitation review's strings) loses the
// sentences that break the rule. A short item (a commitment, an issue,
// a missed commitment) is one sentence, so it is dropped whole.
// See voice/personal-detail.ts for the rule itself.

export type RedactableAnalysis<C extends { description: string }, I extends { title: string }, R> = {
  analysis_markdown: string;
  commitments_json: C[];
  issues_json: I[];
  coverage_json: CoverageReport | null;
  facilitation_review_json: R | null;
};

export type RedactionCounts = {
  sentences: number;
  commitments: number;
  issues: number;
  missed: number;
};

export function redactAnalysis<C extends { description: string }, I extends { title: string }, R>(
  row: RedactableAnalysis<C, I, R>,
  personalDetail: PersonalDetailMatcher
): { row: RedactableAnalysis<C, I, R>; counts: RedactionCounts } {
  let sentences = 0;
  const prose = (t: string): string => {
    const r = removePersonalDetail(t, personalDetail);
    sentences += r.removed;
    return r.text;
  };

  const commitments = row.commitments_json.filter((c) => !personalDetail(c.description));
  const issues = row.issues_json.filter((i) => !personalDetail(i.title));
  const missed = row.coverage_json?.missed.filter((m) => !personalDetail(`${m.quote} ${m.reason}`)) ?? [];

  const redacted: RedactableAnalysis<C, I, R> = {
    analysis_markdown: prose(row.analysis_markdown),
    commitments_json: commitments,
    issues_json: issues,
    coverage_json: row.coverage_json && { ...row.coverage_json, missed },
    facilitation_review_json: row.facilitation_review_json && mapStrings(row.facilitation_review_json, prose),
  };
  return {
    row: redacted,
    counts: {
      sentences,
      commitments: row.commitments_json.length - commitments.length,
      issues: row.issues_json.length - issues.length,
      missed: (row.coverage_json?.missed.length ?? 0) - missed.length,
    },
  };
}

export function redactionCount(c: RedactionCounts): number {
  return c.sentences + c.commitments + c.issues + c.missed;
}

// Applies fn to every string inside a JSON-shaped value.
export function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === "string") return fn(value) as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)])
    ) as T;
  }
  return value;
}
