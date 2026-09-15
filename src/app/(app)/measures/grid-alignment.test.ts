import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The measures table is a CSS grid whose rows are `display: contents`,
// so every cell in every row is placed by the parent's column tracks.
// That has one unforgiving consequence: a row that emits fewer cells
// than there are tracks does not leave the last column empty. The
// next row's first cell flows into it, and every row after that walks
// one column right.
//
// The page still renders. Nothing throws, no test fails, and the only
// symptom is a table where the names have slid under "This week" and
// the numbers have slid off the end. It has to be caught by reading
// the source, which is what this does.
//
// It happened once already: the trailing actions cell was rendered
// only when the caller could author. An admin got six cells against
// six tracks and looked fine; everyone else got five. Nobody saw it
// because a separate bug meant non-admins loaded an empty page, and
// it surfaced the moment a Log / Edit toggle let an admin turn the
// authoring cells off.

const DIR = join(process.cwd(), "src/app/(app)/measures");
const row = readFileSync(join(DIR, "ManagedMeasureRow.tsx"), "utf8");
const section = readFileSync(join(DIR, "OutcomeSection.tsx"), "utf8");
const css = readFileSync(join(DIR, "measures.module.css"), "utf8");

// The header row's JSX, from its class name to the first row that
// follows it. Anchored on the class rather than the component name,
// which also appears in an import above.
function headerBlock(): string {
  const start = section.indexOf("className={styles.measureGridHead}");
  const end = section.indexOf("<ManagedMeasureRow", start);
  const block = section.slice(start, end);
  // A silently empty slice would pass every negative assertion below.
  if (block.length < 50) throw new Error("header block not found");
  return block;
}

describe("the measures grid keeps its columns", () => {
  it("declares six tracks when tracking is on", () => {
    // If this changes, the cell counts below have to change with it.
    const block = css.slice(
      css.indexOf(".measureGrid {"),
      css.indexOf("}", css.indexOf(".measureGrid {"))
    );
    const tracks = block
      .slice(block.indexOf("grid-template-columns:"))
      .split(";")[0]
      .replace("grid-template-columns:", "")
      .trim()
      .split(/\s+(?![^(]*\))/)
      .filter(Boolean);
    expect(tracks).toHaveLength(6);
  });

  it("always emits the trailing actions cell, authoring or not", () => {
    // The specific regression. Wrapping this cell in a condition is
    // what shifted every row.
    expect(row).toContain(
      '<div className={styles.measureCellActions} role="cell">'
    );
    expect(row).not.toMatch(
      /\{authoring \? \(\s*<div className=\{styles\.measureCellActions\}/
    );
  });

  it("always emits the header's trailing spacer", () => {
    const head = headerBlock();
    expect(head).not.toMatch(/\{authoring \? <span aria-hidden \/> : null\}/);
    expect(head).not.toMatch(/\{isAdmin \? <span aria-hidden \/> : null\}/);
  });

  it("gates the same four cells on tracking in the header and the row", () => {
    // Target, Recent, This week and the status dot all appear only
    // when tracking is on. If the header and the row ever disagree
    // about that, the counts diverge again.
    const head = headerBlock();
    expect(head).toContain("{trackingEnabled ? (");
    expect(row).toContain("{trackingEnabled ? (");
  });
});

// ---- The CSF row must not be inside an empty state ---------------
//
// The critical success factor's own row IS the first row of the grid;
// there is no separate heading carrying its name. So anything that
// can replace the grid can also erase the name.
//
// That happened. The "No KPIs yet" message was the first branch of a
// ternary whose else-branch was the whole grid, and a newly created
// CSF has no KPIs by definition — so every new CSF rendered as a
// nameless block with an "Add a KPI" button under it. The page looked
// like the save had failed. It had not: the row was in the element
// the message replaced.
//
// Read from source for the same reason as the alignment check above:
// nothing throws, nothing fails, and the only symptom is a missing
// name on a page that otherwise works.
describe("the critical success factor row survives an empty KPI list", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "app", "(app)", "measures", "OutcomeSection.tsx"),
    "utf8"
  );

  it("renders the CSF row before the empty-KPI note, not inside it", () => {
    const csfRow = src.indexOf('kind="csf"');
    const emptyNote = src.indexOf("No KPIs yet");
    expect(csfRow, 'expected a ManagedMeasureRow with kind="csf"').toBeGreaterThan(-1);
    expect(emptyNote, "expected the empty-KPI note").toBeGreaterThan(-1);
    // The note is a footnote under the grid. If it moves back above
    // the row, it is replacing the grid again.
    expect(
      csfRow,
      "the CSF row now sits after the empty-KPI note, which means the note can replace it again"
    ).toBeLessThan(emptyNote);
  });

  it("opens the grid before the empty-KPI note can be reached", () => {
    // The first test guards the ROW; this one guards the GRID that
    // holds it. Both matter: the row could be moved out of the grid,
    // or the grid could go back to being a ternary branch, and either
    // one loses the name.
    //
    // Asserted as ordering rather than by matching the old ternary,
    // because the note is still a ternary — it just sits underneath
    // now. A regex for its shape matches the correct code too, which
    // is how the first version of this test failed against the fix.
    const grid = src.indexOf("styles.measureGrid");
    const emptyNote = src.indexOf("No KPIs yet");
    expect(grid).toBeGreaterThan(-1);
    expect(
      grid,
      "the grid is rendered after the empty-KPI note, so the note can replace it"
    ).toBeLessThan(emptyNote);
  });
});
