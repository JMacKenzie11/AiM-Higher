import { stripEmDashes } from "@/lib/voice/strip-dashes";
import { personalDetailMatcher } from "@/lib/voice/personal-detail";

// THE QUOTE CALL'S GUARD, without the call. Pure, so it is tested with
// no model (quote-lines.test.ts); the call is in quote-call.ts.
//
// A suggested line is kept only when it is the person's own words: it
// must appear in that person's notes as written, give or take spacing,
// case and the style of the quotation marks. Nothing about health,
// family or personal life, and nothing already on the list.

export const MIN_SUGGESTED = 3;
export const MAX_SUGGESTED = 6;

export const QUOTE_SCHEMA = {
  type: "object",
  properties: {
    lines: { type: "array", items: { type: "string" } },
  },
  required: ["lines"],
};

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

// The same line whatever its closing punctuation, for spotting repeats.
const same = (s: string) => fold(s).replace(/[.!?;:,]+$/, "");

const unwrap = (s: string) => s.trim().replace(/^["'“‘]+|["'”’]+$/g, "").trim();

export function validateQuoteLines(data: unknown, notes: string, existing: readonly string[]): string[] {
  const list = (data as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(list)) return [];
  const source = fold(notes);
  const seen = new Set(existing.map(same));
  const personal = personalDetailMatcher({ mode: "moment" });
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const line = unwrap(stripEmDashes(item)).slice(0, 1000);
    const key = fold(line);
    if (line.split(/\s+/).length < 4) continue;
    if (!source.includes(key)) continue;
    if (seen.has(same(line)) || personal(line)) continue;
    seen.add(same(line));
    out.push(line);
    if (out.length === MAX_SUGGESTED) break;
  }
  return out;
}
