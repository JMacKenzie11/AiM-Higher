import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Two numbers describing the same job must count the same things.
//
// The filter chips said "9 not yet logged" while the line beside them
// said "28 of 28 still to log". Both were arithmetically correct over
// different populations. The same shape produced B&B Electric showing
// 100%, 62% and "13 for 13" follow-through on three surfaces at once,
// which is why `summarizeFollowThrough` exists as one definition.
//
// The rule that keeps falling over: when a page shows two counts of
// one thing, they must be derived from one list.
//
// In the grid there are exactly two consumers of that list, and they
// are the two that would hurt most if they diverged: the line telling
// you how many you have left, and the button that saves them. A save
// covering rows the count ignored writes values nobody was told
// about; a count covering rows the save ignores never reaches zero.

const FILE = join(process.cwd(), "src/app/(app)/measures/MeasuresGrid.tsx");
const src = readFileSync(FILE, "utf8");
// Comments name the things they describe, so a raw search finds
// "writableRows" in a sentence about it. rhythm.test.ts and
// grid-alignment.test.ts have both been bitten by this.
const code = src
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n");

function block(name: string): string {
  const start = code.indexOf(`const ${name} =`);
  if (start === -1) throw new Error(`${name} not found`);
  const end = code.indexOf("\n  );", start);
  if (end === -1) throw new Error(`${name} has no end`);
  return code.slice(start, end);
}

describe("the outstanding line and the save count one population", () => {
  it("derives the writable set once", () => {
    const rows = block("writableRows");
    expect(rows).toContain("g.canLog");
    // And only rows actually due this week. A fortnightly measure in
    // an off week is not outstanding, and saving a blank for it would
    // be writing a number nobody owed.
    expect(rows).toContain("isDueThisWeek");
  });

  it("counts outstanding from that same set", () => {
    expect(block("outstanding")).toContain("writableRows");
  });

  it("saves that same set, and nothing wider", () => {
    const save = code.slice(code.indexOf("function save()"));
    expect(save).toContain("writableRows.map");
    // Not the whole grid. `data.groups` here would mean saving other
    // people's functions, which is what the per-function buttons
    // existed to prevent.
    expect(save.slice(0, save.indexOf("startTransition"))).not.toContain(
      "data.groups"
    );
  });

  it("scopes the line to what the caller can write", () => {
    // A count spanning other people's functions would tell a leader
    // they had six things to do when they have none.
    expect(block("writableRows")).toContain("filter((g) => g.canLog)");
  });

  it("says nothing at all to somebody with nothing to log", () => {
    // Silence rather than "0 of 0". A reader with no functions does
    // not need a to-do line about other people's numbers.
    expect(code).toContain("writableRows.length > 0");
  });
});
