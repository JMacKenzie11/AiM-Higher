import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCORE_WEIGHTS } from "./score";

// WHAT THE SCORE IS FOR.
//
// The facilitation `overall` is not decoration: it is half the
// Meetings discipline on every scorecard (maturity/scorers/
// meetings.ts — cadence is the other half). So what the prompt tells
// the model to reward is a product decision, and a silent edit to it
// moves every customer's number.
//
// The decision, 2026-09-25, replacing the one of 2026-09-24: the
// overall is COMPUTED, as a weighted average of Rhythm,
// Accountability, Alignment and Agenda sections, with the weights in
// score.ts. The model scores the parts and gives no overall. Positive
// framing is scored and shown but is not in the overall.
//
// (The 2026-09-24 decision had the model rank positive framing first
// and agenda last inside a judged overall. That is superseded, not
// forgotten: see the git history of this file.)
//
// This test checks the instruction is still there and still agrees
// with the code, because the failure mode is the prompt and score.ts
// drifting apart and nobody noticing until a scorecard moves.

const PROMPT = readFileSync(
  join(process.cwd(), "src/lib/leadership/facilitation/prompt.v2.md"),
  "utf8"
);

describe("facilitation scoring weight", () => {
  it("reads the prompt at all", () => {
    // A control: every assertion below is a substring check, and
    // they would all fail loudly rather than vacuously — but if the
    // file moves, this says so first.
    expect(PROMPT.length).toBeGreaterThan(2000);
  });

  it("tells the model not to give an overall, and to score every part", () => {
    expect(PROMPT).toContain("You score the parts. You do not give an overall.");
    expect(PROMPT).toMatch(/Every part is required whenever `insufficient_transcript` is false/);
    // And none of the old ranking survives to contradict the code.
    expect(PROMPT).not.toContain("They are not equal, and this is the ranking");
    expect(PROMPT).not.toMatch(/should move the overall score most/i);
  });

  it("weighs exactly the four parts the prompt names, summing to 100", () => {
    expect(Object.keys(SCORE_WEIGHTS).sort()).toEqual(
      ["accountability", "agenda", "alignment", "rhythm"]
    );
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("names the three things that should earn the most", () => {
    const dim = PROMPT.slice(PROMPT.indexOf("**Positive Framing**"));
    const section = dim.slice(0, 1400);
    expect(section, "the check-in").toMatch(/check-in/i);
    expect(section, "generative questions").toMatch(/generative questions/i);
    expect(section, "values in the reasoning").toMatch(/values/i);
  });

  it("keeps agenda adherence as a criterion", () => {
    // It carries a weight in the overall now, rather than a rank.
    expect(PROMPT).toMatch(/agenda adherence/i);
    expect(SCORE_WEIGHTS.agenda).toBeGreaterThan(0);
  });

  it("defines a generative question by the SHIFT, not by sounding open", () => {
    // The definition is what the positive framing score, and the
    // questions block, stand on. Two ways to get it wrong, and the
    // prompt has to refuse both:
    //
    //   a diagnostic question that sounds open — "what's blocking
    //   us" — keeps the room on the problem;
    //
    //   a forward-looking proposal — "what if we tried X" — is still
    //   inside problem-solving with a suggestion attached.
    //
    // Without these, any open question scores, and the dimension is
    // the easiest one to inflate.
    const def = PROMPT.slice(PROMPT.indexOf("2. **Generative Questions**"));
    const section = def.slice(0, def.indexOf("3. **Reframes**"));
    expect(section).toMatch(/away from problem-solving/i);
    expect(section).toMatch(/possibilities, strengths, and shared aspirations/i);
    expect(section, "the diagnostic counter-example").toMatch(/blocking us/i);
    expect(section, "the proposal counter-example").toMatch(/what if we tried/i);
  });

  it("points at all three time horizons, not just the aspirational one", () => {
    // Best of the past, what is working now, what we want most.
    // The PRESENT is the one that goes missing — an earlier draft of
    // this prompt had the past and the future and no "where is this
    // already working", which is the axis a leader can act on
    // fastest and the one that distinguishes a generative question
    // from a wish.
    const def = PROMPT.slice(PROMPT.indexOf("2. **Generative Questions**"));
    const section = def.slice(0, def.indexOf("3. **Reframes**"));
    expect(section, "best of the past").toMatch(/best of the past|moments of excellence/i);
    expect(section, "what is working now").toMatch(/working right now/i);
    expect(section, "what we want for the future").toMatch(/want most for the future/i);
    // And they weigh the same. Without this the model reads the list
    // as a ranking and scores the future-facing ones highest.
    expect(section).toMatch(/all three count|counting equally/i);
  });

});
