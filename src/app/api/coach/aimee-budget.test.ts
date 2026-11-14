import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// AIMEE STAYS LEAN (docs/aimee-rules.md, Jason 2026-11-14: "whenever we
// make any changes to Aimee ... she stays as optimized as possible").
//
// The characterisation test pins the exact system prompt each kind of
// conversation is sent, by hash and size. This holds the size to a
// budget, so instructions only grow by a decision: raise a budget here,
// in the PR that needs it, with the first-reply eval's before and
// after (npm run eval:aimee) in its description.

const BUDGET_CHARS: Record<string, number> = {
  "plain Aimee on the page": 49_000,
  "plain Aimee in the panel": 49_500,
  "about a person": 38_000,
  "an agent": 31_000,
};

function snapshotSizes(): Record<string, number> {
  const snap = readFileSync("src/app/api/coach/__snapshots__/route-characterisation.test.ts.snap", "utf8");
  const out: Record<string, number> = {};
  for (const m of snap.matchAll(/what each kind of conversation is sent > (.+?) 1`\] = `[\s\S]*?"systemChars": (\d+)/g)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

describe("Aimee's instructions stay inside their budget", () => {
  it("covers every kind of conversation the route pins", () => {
    expect(Object.keys(snapshotSizes()).sort()).toEqual(Object.keys(BUDGET_CHARS).sort());
  });

  for (const [shape, budget] of Object.entries(BUDGET_CHARS)) {
    it(`${shape}: at most ${budget.toLocaleString("en")} characters`, () => {
      expect(snapshotSizes()[shape]).toBeLessThanOrEqual(budget);
    });
  }
});

// RULES THAT DRIFTED INTO CONFLICT, SAID ONCE. The data rule was said
// in the base, the voice rules and the preamble, and the copies ended
// up arguing (Aimee opened on company figures for a person not in
// AiMS, 2026-11-13); lists were banned in one block and asked for in
// another. Each now has one home. This is not a ban on repetition:
// removing the preamble's repeat of "one question" and "actually"
// raised first replies sent back from 33% to 52% (2026-11-14), so a
// repeat that measurably helps stays (docs/aimee-rules.md).
describe("rules that conflicted, said once", () => {
  const files = [
    "prompts/leadership-coach.md",
    "prompts/aims-voice.md",
    "src/lib/coach/voice-rules.ts",
    "src/lib/coach/general-preamble.ts",
    "src/lib/voice/core.ts",
  ].map((f) => readFileSync(f, "utf8")).join("\n");
  for (const phrase of [/never guess at a number/gi, /Write in prose/g, /bulleted lists/gi]) {
    it(`${phrase.source} appears at most once`, () => {
      expect((files.match(phrase) ?? []).length).toBeLessThanOrEqual(1);
    });
  }
});
