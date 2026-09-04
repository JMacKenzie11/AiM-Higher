import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Two numbers describing the same job must count the same things.
//
// The filter chips said "9 not yet logged" while the line beside them
// said "28 of 28 still to log". Both were arithmetically correct. The
// chips counted KPIs; the line counted critical success factors as
// well, which is what the page actually asks you to fill in.
//
// This is the third time this shape has appeared in this codebase.
// B&B Electric showed 100%, 62% and "13 for 13" follow-through on
// three surfaces at once, each right over a different population —
// which is why `summarizeFollowThrough` exists as one definition. The
// dashboard's pending card counted KPIs only for the same reason and
// was removed.
//
// The rule that keeps falling over: when a page shows two counts of
// one thing, they have to be derived from one list. These assertions
// pin that list.

const FILE = join(
  process.cwd(),
  "src/app/(app)/measures/MeasuresManager.tsx"
);
const src = readFileSync(FILE, "utf8");

function block(name: string): string {
  const start = src.indexOf(`const ${name} = useMemo(`);
  if (start === -1) throw new Error(`${name} not found`);
  const end = src.indexOf("[functions]", start);
  if (end === -1) throw new Error(`${name} has no dependency array`);
  return src.slice(start, end);
}

describe("the chips and the outstanding line count one population", () => {
  it("counts critical success factors in the chips, not only KPIs", () => {
    // `o.outcomes.flatMap(o => o.measures)` alone is the bug: it
    // walks straight past the CSF to the KPIs beneath it.
    const chips = block("allMeasures");
    expect(chips).toContain("o.measures");
    expect(chips).toMatch(/description: o\.title/);
  });

  it("counts critical success factors in the outstanding line", () => {
    const line = block("myEntryTargets");
    expect(line).toContain("o.id");
    expect(line).toContain("o.measures.map");
  });

  it("scopes the outstanding line to functions the caller can log", () => {
    // A count spanning other people's functions would never reach
    // zero for a leader.
    expect(block("myEntryTargets")).toContain("f.canLog");
  });

  it("says whose functions it means when the two sets differ", () => {
    // An admin can log everything, so both numbers describe the same
    // set and no qualifier is needed. A leader sees functions they
    // cannot log, and two unqualified numbers side by side is the
    // confusion this guards against.
    expect(src).toContain(
      "const scoped = myEntryTargets.length < allEntryTargets.length"
    );
    expect(src).toContain("on your functions");
  });
});
