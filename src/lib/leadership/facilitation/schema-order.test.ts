import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// EVIDENCE FIRST, VERDICTS LAST.
//
// Tool-call JSON is emitted in the order the schema declares, token
// by token. A field written early is written before the model has
// done the work described by the fields after it.
//
// executive_summary and strengths used to sit ABOVE fourws_audit, so
// the model delivered its verdict first and its evidence second, and
// nothing reconciled them. One stored row from Benson Seafood,
// 2026-09-22, held both of these at once:
//
//   executive_summary  "the 4Ws framework wasn't applied to any of
//                       the issues worked through"
//   fourws_audit       8 issues, every one with at least one step,
//                      3 with all four
//
// The same row's "what worked" said the shuttle bus gap landed with
// clear next moves while its own audit marked it no Way and no
// Who/When.
//
// ---- WHY THIS IS A TEST AND NOT A COMMENT ----------------------
//
// Nothing else catches it. The type in types.ts is an object type
// and object types have no order. Reordering these keys compiles,
// lints, passes every existing test, and silently restores the bug —
// and the symptom is a confident sentence at the top of a customer's
// meeting page, which is the worst place to be wrong.

const SOURCE = readFileSync(
  join(process.cwd(), "src/lib/leadership/facilitation/analyze.ts"),
  "utf8"
);

// The declared order of the tool schema's top-level properties.
function schemaOrder(): string[] {
  const start = SOURCE.indexOf("    properties: {\n");
  expect(start, "the tool schema's properties block").toBeGreaterThan(-1);
  const block = SOURCE.slice(start, SOURCE.indexOf("\n    },\n  },\n};", start));
  return [...block.matchAll(/^ {6}([a-z_]+): \{/gm)].map((m) => m[1]);
}

describe("facilitation review schema order", () => {
  const order = schemaOrder();
  const at = (name: string) => {
    const i = order.indexOf(name);
    expect(i, `${name} is missing from the schema`).toBeGreaterThan(-1);
    return i;
  };

  it("declares the fields at all", () => {
    // A control. If the schema moves or the regex stops matching,
    // every ordering assertion below would pass on an empty list.
    expect(order.length).toBeGreaterThan(8);
  });

  it("gathers the 4Ws audit before anything summarises it", () => {
    expect(at("fourws_audit")).toBeLessThan(at("executive_summary"));
    expect(at("fourws_audit")).toBeLessThan(at("strengths"));
    expect(at("fourws_audit")).toBeLessThan(at("growth_edges"));
  });

  it("gathers the observed moments before the strengths drawn from them", () => {
    for (const moments of [
      "appreciation_moments",
      "generative_questions",
      "reframes",
    ]) {
      expect(at(moments)).toBeLessThan(at("strengths"));
    }
  });

  it("scores and summarises last, with the whole review in view", () => {
    const last = order.length - 1;
    expect(at("executive_summary")).toBe(last);
    // No `overall` at all: it is computed from the parts (score.ts).
    expect(order).not.toContain("overall");
  });

  it("asks for the same order in `required`", () => {
    // Not load-bearing for generation, but two different orders in
    // one schema is how the next person talks themselves into
    // "the order must not matter".
    const req = SOURCE.slice(SOURCE.indexOf("    required: ["));
    const listed = [...req.slice(0, req.indexOf("],")).matchAll(/"([a-z_]+)"/g)]
      .map((m) => m[1]);
    const inBoth = order.filter((k) => listed.includes(k));
    expect(listed).toEqual(inBoth);
  });

  it("tells the model the summary must not contradict the audit", () => {
    // Ordering makes the right answer available; the description
    // makes it required. Belt and braces, because the cost of the
    // failure is a customer reading a confident wrong sentence.
    const desc = SOURCE.slice(SOURCE.indexOf("executive_summary: {"));
    expect(desc.slice(0, 700)).toContain("must not contradict fourws_audit");
  });
});
