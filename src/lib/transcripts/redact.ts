import { removePersonalDetail, type PersonalDetailMatcher } from "@/lib/voice/personal-detail";
import type { CoverageReport } from "./coverage";
import type { Reword } from "./reword";

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
// Prose (the summary, the facilitation review, a commitment's clarity
// note) loses the sentences that break the rule.
//
// An item (a commitment, an issue, a missed commitment's reason) is
// NEVER dropped (Jason, 2026-10-01: "A commitment must never be
// lost"). It is reworded without the detail (reword.ts). If the rewrite
// still breaks the rule, or there is none, the item is kept exactly as
// it was and marked `needs_rewording`, for the company admin to reword.
// A missed commitment's quote is the transcript's own words and is
// never reworded; a quote that breaks the rule marks the item too.
//
// See voice/personal-detail.ts for the rule itself.

type Flaggable = { needs_rewording?: boolean };
type Commitment = Flaggable & { description: string; clarity_note?: string | null };
type Issue = Flaggable & { title: string };

export type RedactableAnalysis<C extends Commitment, I extends Issue, R> = {
  analysis_markdown: string;
  commitments_json: C[];
  issues_json: I[];
  coverage_json: CoverageReport | null;
  facilitation_review_json: R | null;
};

export type RedactionCounts = {
  // Sentences taken out of prose.
  sentences: number;
  // Items reworded cleanly.
  reworded: number;
  // Items kept as they were and marked for the company admin.
  flagged: number;
};

export function redactionCount(c: RedactionCounts): number {
  return c.sentences + c.reworded + c.flagged;
}

export type SettledText = { text: string; reworded: boolean; needsRewording: boolean };

// Rewords every text that breaks the rule, in one call, and checks
// each rewrite. Texts that pass are returned untouched.
export async function settleTexts(
  texts: readonly string[],
  personalDetail: PersonalDetailMatcher,
  reword: Reword
): Promise<SettledText[]> {
  const flagged = texts.flatMap((t, i) => (personalDetail(t) ? [i] : []));
  const rewrites = flagged.length > 0 ? await reword(flagged.map((i) => texts[i])) : [];
  return texts.map((text, i) => {
    const k = flagged.indexOf(i);
    if (k === -1) return { text, reworded: false, needsRewording: false };
    const rewrite = rewrites[k];
    return rewrite && !personalDetail(rewrite)
      ? { text: rewrite, reworded: true, needsRewording: false }
      : { text, reworded: false, needsRewording: true };
  });
}

export async function redactAnalysis<C extends Commitment, I extends Issue, R>(
  row: RedactableAnalysis<C, I, R>,
  personalDetail: PersonalDetailMatcher,
  reword: Reword
): Promise<{ row: RedactableAnalysis<C, I, R>; counts: RedactionCounts }> {
  let sentences = 0;
  const prose = (t: string): string => {
    const r = removePersonalDetail(t, personalDetail);
    sentences += r.removed;
    return r.text;
  };
  const missed = row.coverage_json?.missed ?? [];

  // One rewording call for the whole meeting.
  const settled = await settleTexts(
    [
      ...row.commitments_json.map((c) => c.description),
      ...row.issues_json.map((i) => i.title),
      ...missed.map((m) => m.reason),
    ],
    personalDetail,
    reword
  );
  const commitmentsDone = settled.slice(0, row.commitments_json.length);
  const issuesDone = settled.slice(row.commitments_json.length, row.commitments_json.length + row.issues_json.length);
  const missedDone = settled.slice(row.commitments_json.length + row.issues_json.length);

  const mark = <T extends Flaggable>(item: T, needs: boolean): T =>
    needs ? { ...item, needs_rewording: true } : item;

  const redacted: RedactableAnalysis<C, I, R> = {
    analysis_markdown: prose(row.analysis_markdown),
    commitments_json: row.commitments_json.map((c, i) =>
      mark(
        {
          ...c,
          description: commitmentsDone[i].text,
          ...(c.clarity_note ? { clarity_note: prose(c.clarity_note) } : {}),
        },
        commitmentsDone[i].needsRewording
      )
    ),
    issues_json: row.issues_json.map((iss, i) =>
      mark({ ...iss, title: issuesDone[i].text }, issuesDone[i].needsRewording)
    ),
    coverage_json: row.coverage_json && {
      ...row.coverage_json,
      missed: missed.map((m, i) =>
        mark({ ...m, reason: missedDone[i].text }, missedDone[i].needsRewording || personalDetail(m.quote) !== null)
      ),
    },
    facilitation_review_json: row.facilitation_review_json && mapStrings(row.facilitation_review_json, prose),
  };

  const quoteOnly = missed.filter((m, i) => !missedDone[i].needsRewording && personalDetail(m.quote)).length;
  return {
    row: redacted,
    counts: {
      sentences,
      reworded: settled.filter((s) => s.reworded).length,
      flagged: settled.filter((s) => s.needsRewording).length + quoteOnly,
    },
  };
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
