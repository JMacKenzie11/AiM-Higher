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
  it("derives the chased set once", () => {
    const rows = block("writableRows");
    expect(rows).toContain("g.canLog");
    // And only rows actually due in the week being chased. A
    // fortnightly measure in an off week is not outstanding.
    expect(rows).toContain("isDueInWeek");
  });

  it("chases the week that just closed, which is the one with a deadline", () => {
    // The Saturday nudge asks about the closed week and makes it due
    // the coming Friday. Two numbers describing one job must count
    // the same things, so this counts that week too. The current week
    // is there to type into as you go and is not late yet.
    expect(code).toContain(
      "const chasedWeek = data.previousWeekEnding ?? weekEnding"
    );
    expect(block("writableRows")).toContain("chasedWeek");
    expect(block("outstanding")).toContain("chasedWeek");
  });

  it("counts outstanding from that same set", () => {
    expect(block("outstanding")).toContain("writableRows");
  });

  it("saves every editable cell it owns, across both open weeks", () => {
    // Wider than the chased set on purpose, and only in one
    // direction: a value typed into the current column has to save
    // too, or the box lies. Still filtered to canLog, so it never
    // reaches another function.
    const save = code.slice(code.indexOf("function save()"));
    const upToTransition = save.slice(0, save.indexOf("startTransition"));
    expect(upToTransition).toContain("filter((g) => g.canLog)");
    expect(upToTransition).toContain("editableWeeks");
    expect(upToTransition).toContain("isDueInWeek");
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
  it("renders an input only on an open week AND with canLog", () => {
    expect(code).toContain("if (editable && canLog) {");
    // Two weeks are open: the current one and the one that just
    // closed. Everything older is read-only, because a grid where any
    // of fifty-two cells is editable invites a quiet correction to
    // April.
    expect(block("editableWeeks")).toContain("data.previousWeekEnding");
  });

  it("passes canLog down per function, not per page", () => {
    // `group.canLog`, not the page-wide `authoring`. An admin gets
    // every function because their canLog is true everywhere, which
    // is the same rule reaching a different answer rather than a
    // second rule.
    expect(code).toContain("canLog={group.canLog}");
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

// ---- Connecting a measure to a spreadsheet ---------------------
//
// It lived in the row's settings strip, and deleting ManagedMeasureRow
// for the grid took it with it. The import survived in EditMeasureForm
// and nothing rendered it, so a company with external_measures on had
// no way to map a measure at all. The same shape as the add control
// disappearing, and just as invisible: nothing throws, the flag is
// still on, and the surface is simply not there.
describe("the external-source controls are reachable", () => {
  it("renders them in the drawer", () => {
    expect(code).toContain("<ExternalSourceControls measureId={editingRow.id} />");
  });

  it("stays open on a new measure so the fields go live", () => {
    // A mapping needs a measure to attach to and there is no id until
    // the create returns. Closing the drawer there would mean adding
    // the measure, finding it in the table and opening it again to do
    // the half of the job the panel was already showing.
    expect(code).toContain("onCreated={(id) =>");
    expect(code).toContain("setEditing(id)");
    // And it says so while adding, rather than leaving a gap where
    // the fields will be.
    expect(code).toContain("drawerHint");
  });

  it("is flat, not behind a disclosure", () => {
    const ext = readFileSync(
      join(process.cwd(), "src/app/(app)/measures/external/ExternalSourceControls.tsx"),
      "utf8"
    );
    // The disclosure earned its place on a table row, under every
    // measure on the page. In a drawer holding one measure, a click
    // to reach half its settings is a click for nothing.
    expect(ext).not.toContain("<details");
    expect(ext).not.toContain("<summary");
  });

  it("is not imported anywhere that does not render it", () => {
    // The dead import is how this went unnoticed: the symbol was
    // still referenced, so nothing flagged it as unused.
    const form = readFileSync(
      join(process.cwd(), "src/app/(app)/measures/EditMeasureForm.tsx"),
      "utf8"
    );
    expect(form).not.toContain("ExternalSourceControls");
  });
});

// ---- Show on company dashboard ---------------------------------
//
// Stored and set from the settings panel, and read by nothing yet.
// What the dashboard does with it is a decision that has not been
// made; landing the storage on its own means a later change reads
// data people have curated rather than a column full of defaults.
describe("show on company dashboard", () => {
  it("is on the settings panel, under the reminder", () => {
    const form = readFileSync(
      join(process.cwd(), "src/app/(app)/measures/EditMeasureForm.tsx"),
      "utf8"
    );
    const reminder = form.indexOf('name="auto_track"');
    const dash = form.indexOf('name="show_on_dashboard"');
    expect(dash).toBeGreaterThan(-1);
    expect(dash).toBeGreaterThan(reminder);
  });

  it("defaults to on, so nothing that reads it later blanks a card", () => {
    // Every live measure is on the dashboard's card today. An opt-in
    // default would empty it for every company the moment something
    // filters on this, and the card hides itself when there is
    // nothing to plot, so the failure is a screen going quietly
    // blank.
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/0218_show_on_dashboard.sql"),
      "utf8"
    );
    expect(migration).toContain("not null default true");
  });

  it("is written by both the create and the update path", () => {
    const actions = readFileSync(
      join(process.cwd(), "src/lib/chart/actions.ts"),
      "utf8"
    );
    expect(
      (actions.match(/show_on_dashboard: showOnDashboard/g) ?? []).length
    ).toBe(2);
  });
});

// ---- Success Tracking does not reach this page -----------------
//
// It used to. The flag decided whether the week columns existed at
// all, so a company without it got a table it could read and never
// type into — and the Target field was hidden on the form besides.
// That was the KPI-era gate outliving the KPIs.
//
// The flag now governs only what happens WITHOUT being asked: the
// Friday nudge, the Issue raised from a below-target entry, the
// commitment raised for an actual nobody entered. None of those is
// this page. So this page must not read it, and these pin that: a
// re-gate would be a one-word edit and would silently take the
// week columns away from every company again.
describe("Success Tracking does not gate the grid", () => {
  it("does not read the flag anywhere in the grid", () => {
    expect(code).not.toContain("trackingEnabled");
    expect(code).not.toContain("performance_tracking");
  });

  it("renders every month it was given", () => {
    expect(code).toContain("const visibleMonths = data.months;");
    expect(code).toContain("visibleMonths.flatMap((m): Column[] =>");
  });

  it("is not read by the page that renders the grid either", () => {
    const page = readFileSync(
      join(process.cwd(), "src/app/(app)/measures/page.tsx"),
      "utf8"
    );
    expect(page).not.toContain("performance_tracking");
  });

  it("leaves the Target field on the form unconditionally", () => {
    // The field itself was inside `{trackingEnabled ? (`, so a
    // company without the flag could not type a target at all.
    const form = readFileSync(
      join(process.cwd(), "src/app/(app)/measures/EditMeasureForm.tsx"),
      "utf8"
    );
    expect(form).not.toContain("trackingEnabled");
    expect(form).toContain('name="target"');
    expect(form).toContain('name="target_direction"');
  });

  it("keeps the add button in the toolbar, not in a second place", () => {
    // One toolbar, whichever half has anything in it.
    const toolbars = (code.match(/styles\.gridToolbar\}/g) ?? []).length;
    expect(toolbars).toBe(1);
  });

  it("holds the left half so the actions stay right", () => {
    // Without a placeholder the buttons slide across when there is no
    // count to show, which is the difference between the two
    // placements it used to have.
    const toolbar = code.slice(code.indexOf("styles.gridToolbar}"));
    expect(toolbar.slice(0, toolbar.indexOf("gridToolbarActions"))).toContain(
      "<span />"
    );
  });
});
