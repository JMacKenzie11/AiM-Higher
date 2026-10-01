import { findPersonalDetail, rewritePersonalDetail, type PersonalDetailMatcher } from "@/lib/voice/personal-detail";
import type { CoverageReport } from "./coverage";
import type { Reword } from "./reword";

// WHAT THE PRIVATE-LIFE RULE DOES TO A MEETING'S RECORD.
//
// Used in three places, so they cannot disagree:
//
//   summary.ts: the summary, as soon as it is written, because the
//     meeting questions read it next;
//   analyze.ts, at the write: the whole row, after every pass has run
//     on the full data (coverage compares against every extracted
//     commitment);
//   scripts/propose-summary-redactions.ts: rows stored before the rule.
//
// Every line that breaks the rule is sent once to be reworded
// (reword.ts), in one call for the batch. Then:
//
//   a sentence of prose (the summary, the facilitation review, a
//     commitment's clarity note) takes its rewrite when the rewrite
//     passes the same check, and is taken out otherwise;
//   an item (a commitment, an issue, a missed commitment's reason) is
//     NEVER dropped (Jason, 2026-10-01: "A commitment must never be
//     lost"). It takes its rewrite when that passes, and is otherwise
//     kept exactly as written and marked `needs_rewording`, for the
//     company admin. A missed commitment's quote is the transcript's
//     words and is never reworded; a quote that breaks the rule marks
//     the item too.
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
  // Prose sentences taken out.
  sentences: number;
  // Sentences and items reworded cleanly.
  reworded: number;
  // Items kept as they were and marked for the company admin.
  flagged: number;
};

export function redactionCount(c: RedactionCounts): number {
  return c.sentences + c.reworded + c.flagged;
}

// Every flagged line, reworded once, in one call. Returns the rewrite
// for each line that has one which passes the check; a line missing
// from the map has none.
export async function rewordLines(
  lines: readonly string[],
  personalDetail: PersonalDetailMatcher,
  reword: Reword
): Promise<Map<string, string>> {
  const flagged = [...new Set(lines.filter((l) => personalDetail(l)))];
  const clean = new Map<string, string>();
  if (flagged.length === 0) return clean;
  const rewrites = await reword(flagged);
  flagged.forEach((line, k) => {
    const r = rewrites[k]?.trim();
    if (r && !personalDetail(r)) clean.set(line, r);
  });
  return clean;
}

function proseSentences(texts: readonly string[], personalDetail: PersonalDetailMatcher): string[] {
  return texts.flatMap((t) => findPersonalDetail(t, personalDetail).map((f) => f.sentence));
}

// Prose on its own (the summary, as soon as it is written).
export async function rewordProse(
  texts: readonly string[],
  personalDetail: PersonalDetailMatcher,
  reword: Reword
): Promise<{ texts: string[]; reworded: number; removed: number }> {
  const rewrites = await rewordLines(proseSentences(texts, personalDetail), personalDetail, reword);
  let reworded = 0;
  let removed = 0;
  const out = texts.map((t) => {
    const r = rewritePersonalDetail(t, personalDetail, (s) => rewrites.get(s));
    reworded += r.reworded;
    removed += r.removed;
    return r.text;
  });
  return { texts: out, reworded, removed };
}

export type SettledText = { text: string; reworded: boolean; needsRewording: boolean };

// Items on their own (the script's Commitments and Issues page rows).
export async function settleTexts(
  texts: readonly string[],
  personalDetail: PersonalDetailMatcher,
  reword: Reword
): Promise<SettledText[]> {
  const rewrites = await rewordLines(texts, personalDetail, reword);
  return texts.map((text) => settleItem(text, personalDetail, rewrites));
}

function settleItem(text: string, personalDetail: PersonalDetailMatcher, rewrites: Map<string, string>): SettledText {
  if (!personalDetail(text)) return { text, reworded: false, needsRewording: false };
  const rewrite = rewrites.get(text);
  return rewrite
    ? { text: rewrite, reworded: true, needsRewording: false }
    : { text, reworded: false, needsRewording: true };
}

export async function redactAnalysis<C extends Commitment, I extends Issue, R>(
  row: RedactableAnalysis<C, I, R>,
  personalDetail: PersonalDetailMatcher,
  reword: Reword
): Promise<{ row: RedactableAnalysis<C, I, R>; counts: RedactionCounts; rewrites: ReadonlyMap<string, string> }> {
  const missed = row.coverage_json?.missed ?? [];

  // Every prose string, so its flagged sentences join the one call.
  const reviewStrings: string[] = [];
  if (row.facilitation_review_json) {
    mapStrings(row.facilitation_review_json, (t) => {
      reviewStrings.push(t);
      return t;
    });
  }
  const prose = [
    row.analysis_markdown,
    ...reviewStrings,
    ...row.commitments_json.map((c) => c.clarity_note ?? ""),
  ];
  const items = [
    ...row.commitments_json.map((c) => c.description),
    ...row.issues_json.map((i) => i.title),
    ...missed.map((m) => m.reason),
  ];
  const rewrites = await rewordLines([...proseSentences(prose, personalDetail), ...items], personalDetail, reword);

  let sentences = 0;
  let reworded = 0;
  let flagged = 0;
  const settleProse = (t: string): string => {
    const r = rewritePersonalDetail(t, personalDetail, (s) => rewrites.get(s));
    sentences += r.removed;
    reworded += r.reworded;
    return r.text;
  };
  const settle = (t: string): SettledText => {
    const s = settleItem(t, personalDetail, rewrites);
    if (s.reworded) reworded++;
    if (s.needsRewording) flagged++;
    return s;
  };
  const mark = <T extends Flaggable>(item: T, needs: boolean): T =>
    needs ? { ...item, needs_rewording: true } : item;

  const redacted: RedactableAnalysis<C, I, R> = {
    analysis_markdown: settleProse(row.analysis_markdown),
    commitments_json: row.commitments_json.map((c) => {
      const d = settle(c.description);
      return mark(
        { ...c, description: d.text, ...(c.clarity_note ? { clarity_note: settleProse(c.clarity_note) } : {}) },
        d.needsRewording
      );
    }),
    issues_json: row.issues_json.map((iss) => {
      const t = settle(iss.title);
      return mark({ ...iss, title: t.text }, t.needsRewording);
    }),
    coverage_json: row.coverage_json && {
      ...row.coverage_json,
      missed: missed.map((m) => {
        const r = settle(m.reason);
        const quoteBreaks = personalDetail(m.quote) !== null;
        if (quoteBreaks && !r.needsRewording) flagged++;
        return mark({ ...m, reason: r.text }, r.needsRewording || quoteBreaks);
      }),
    },
    facilitation_review_json: row.facilitation_review_json && mapStrings(row.facilitation_review_json, settleProse),
  };

  return { row: redacted, counts: { sentences, reworded, flagged }, rewrites };
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
