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

// ---- What a reader can type into -------------------------------
//
// A function's owner sees every function on this page, and must be
// able to type into exactly one of them.
//
// The worry worth guarding is not that the save would write somebody
// else's row: it would not, because `writableRows` is filtered above
// and RLS on success_measure_entries admits only the lead, an admin
// or a guide. It is that the page might INVITE the typing. An input
// you can fill in and then quietly lose on save is worse than no
// input, and it is the shape of bug that survives review because
// everything behind it is correct.
describe("only your own functions get an input", () => {
  it("renders an input only on the current week AND with canLog", () => {
    expect(code).toContain("if (isCurrent && canLog) {");
  });

  it("passes canLog down per function, not per page", () => {
    // `group.canLog`, not the page-wide `authoring`. An admin gets
    // every function because their canLog is true everywhere, which
    // is the same rule reaching a different answer rather than a
    // second rule.
    expect(code).toContain("canLog={group.canLog && trackingEnabled}");
  });

  it("falls back to reading the value, not to a disabled box", () => {
    // A greyed-out input is a tease and leaves a dead column. The
    // cell shows the number instead, which is what a reader came for.
    const cellView = code.slice(code.indexOf("function GridCellView"));
    expect(cellView).toContain("cell.displayValue");
    expect(cellView).not.toContain("disabled={!canLog}");
  });
});

// ---- What a reader with no seat sees ---------------------------
//
// A team member who leads no function is a reader of this page:
// every value, no inputs, no pencil, no bin, and no way to add. That
// is three separate controls that each have to be gated, and the one
// most likely to be forgotten is the add button, because it lives in
// the toolbar rather than on a row.
describe("someone who owns no function gets no authoring controls", () => {
  it("derives authoring from the same canLog the rows use", () => {
    // Not a separate isAdmin check. An admin reaches it because their
    // canLog is true everywhere, which is one rule giving a different
    // answer rather than a second rule to keep in step.
    expect(code).toContain(
      "const authoring = isAdmin || data.groups.some((g) => g.canLog)"
    );
  });

  it("offers only the functions this caller may add to", () => {
    expect(code).toContain(
      "const addableGroups = data.groups.filter((g) => g.canLog)"
    );
  });

  it("hides the add control when there are none", () => {
    // Two placements, one with Success Tracking on and one without,
    // and both have to carry the gate.
    const gates = code.match(/addableGroups\.length > 0/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(2);
    expect(code).not.toMatch(/\{\s*authoring \?\s*\(\s*<button[^>]*Add a critical/);
  });

  it("hides the pencil and the bin per function", () => {
    // The actions COLUMN exists if the caller can author anywhere, so
    // the table does not gain and lose a track as you scroll. What
    // goes in it is decided per row.
    expect(code).toContain("{group.canLog ? (");
  });
});
