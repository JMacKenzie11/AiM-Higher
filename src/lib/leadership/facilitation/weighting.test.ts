import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// WHAT THE SCORE IS FOR.
//
// The facilitation `overall` is not decoration: it is half the
// Meetings discipline on every scorecard (maturity/scorers/
// meetings.ts — cadence is the other half). So what the prompt tells
// the model to reward is a product decision, and a silent edit to it
// moves every customer's number.
//
// The decision, 2026-09-24: appreciative practice leads — a real
// check-in, generative questions that go somewhere, decisions
// reasoned against the company's values. Agenda adherence stays a
// criterion and becomes a weak one. A meeting that walked every
// numbered section and opened nothing should not outscore a meeting
// that went off the running order and moved something.
//
// This test does not check the model's judgement — no source test
// can. It checks that the instruction is still there, because it is
// one paragraph in a long prompt and the failure mode is somebody
// tidying it out and nobody noticing until a scorecard drifts.

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

  it("states the ranking rather than leaving the dimensions equal", () => {
    expect(PROMPT).toContain("They are not equal, and this is the ranking");
    const ranking = PROMPT.slice(PROMPT.indexOf("They are not equal"));
    const para = ranking.slice(0, 400);
    expect(para).toMatch(/Positive framing leads/i);
    expect(para).toMatch(/Rhythm.*comes last/is);
  });

  it("names the three things that should earn the most", () => {
    const dim = PROMPT.slice(PROMPT.indexOf("**Positive Framing**"));
    const section = dim.slice(0, 1400);
    expect(section, "the check-in").toMatch(/check-in/i);
    expect(section, "generative questions").toMatch(/generative questions/i);
    expect(section, "values in the reasoning").toMatch(/values/i);
  });

  it("keeps agenda adherence as a criterion, and says it is a weak one", () => {
    // Not removed — the user asked for it to count less, not to stop
    // counting. A prompt that dropped it entirely would be a
    // different product decision made by accident.
    expect(PROMPT).toMatch(/agenda adherence/i);
    expect(PROMPT).toContain("It is a real criterion and a weak one");
  });

  it("defines a generative question by the SHIFT, not by sounding open", () => {
    // The definition is the load-bearing part now that positive
    // framing leads the score. Two ways to get it wrong, and the
    // prompt has to refuse both:
    //
    //   a diagnostic question that sounds open — "what's blocking
    //   us" — keeps the room on the problem;
    //
    //   a forward-looking proposal — "what if we tried X" — is still
    //   inside problem-solving with a suggestion attached.
    //
    // Without these, any open question scores, and the dimension
    // carrying the most weight is the easiest one to inflate.
    const def = PROMPT.slice(PROMPT.indexOf("2. **Generative Questions**"));
    const section = def.slice(0, def.indexOf("3. **Reframes**"));
    expect(section).toMatch(/away from problem-solving/i);
    expect(section).toMatch(/possibilities, strengths, and shared aspirations/i);
    expect(section, "the diagnostic counter-example").toMatch(/blocking us/i);
    expect(section, "the proposal counter-example").toMatch(/what if we tried/i);
  });

  it("gives the model a worked case in both directions", () => {
    // A ranking with no example is a preference; a ranking with a
    // number attached is an instruction.
    const practical = PROMPT.slice(PROMPT.indexOf("**Practically:**"));
    expect(practical.slice(0, 500)).toMatch(/should not clear 6/);
    expect(practical.slice(0, 500)).toMatch(/8 or 9/);
  });
});
