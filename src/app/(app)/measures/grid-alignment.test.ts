import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { groupWeeksByMonth } from "@/lib/measures/grid";

// The measures table kept its columns in line, and now has to keep
// doing it while the column count changes underneath.
//
// ---- WHAT THIS USED TO GUARD --------------------------------
//
// The page was a CSS grid whose rows are `display: contents`, so a
// row emitting fewer cells than there are tracks did not leave the
// last column empty: the next row's first cell flowed into it and
// every row after walked one column right. It happened once, when the
// trailing actions cell rendered only for admins. The page still
// rendered, nothing threw, and the only symptom was names sliding
// under "This week".
//
// ---- WHAT IT GUARDS NOW -------------------------------------
//
// A real table, so the browser checks cell counts and that class of
// bug is gone. What replaced it is a column count that CHANGES: a
// month collapses to one column and expands to four or five. Three
// things have to agree on that number, and two of them are in
// different parts of the file from the third:
//
//   the header's month row  (colSpan per open month)
//   the body's cells        (one per entry in `columns`)
//   the edit row's colSpan  (5 pinned columns + the same `columns`)
//
// The first two are structural and hard to get wrong once `columns`
// is the single source. The third is a hand-written arithmetic
// expression, which is exactly the kind of thing that goes stale when
// a sixth pinned column is added.

const DIR = join(process.cwd(), "src/app/(app)/measures");
const src = readFileSync(join(DIR, "MeasuresGrid.tsx"), "utf8");
const css = readFileSync(join(DIR, "measures.module.css"), "utf8");
const code = src
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n");

describe("one source decides how many week columns there are", () => {
  it("builds the column list once", () => {
    expect(code).toContain("const columns = useMemo<Column[]>");
  });

  it("renders the body from that list", () => {
    expect(code).toContain("{columns.map((col) =>");
  });

  it("declares each pinned column once, spanning both header rows", () => {
    // Declaring them in both rows left a tall blank band across the
    // top of the table, so each is declared once with rowSpan.
    //
    // `styles.gridPin}` with the brace: `gridPinArea` also contains
    // "styles.gridPin" and would double every count.
    const head = code.slice(code.indexOf("<thead>"), code.indexOf("</thead>"));
    // Area, Owner, Actions, Name, Frequency, Target.
    expect((head.match(/styles\.gridPin\}/g) ?? []).length).toBe(6);
    expect((head.match(/rowSpan=\{2\}/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("has no full-width row left to keep in step with the columns", () => {
    // The settings form was a <tr> spanning the whole table, and its
    // colSpan was hand-written arithmetic over the pinned count. It
    // opens in a drawer now, so that arithmetic is gone rather than
    // merely kept correct.
    expect(code).not.toContain("colSpan={5");
  });

  it("gives an open month a colSpan equal to its weeks", () => {
    expect(code).toContain("colSpan={m.weeks.length}");
  });

  it("makes a closed month one cell tall enough for both header rows", () => {
    // Without rowSpan the second header row has a hole where the
    // closed month is, and every week label after it shifts left.
    expect(code).toContain("rowSpan={2}");
  });

  it("emits a body cell for a closed month too", () => {
    // A collapsed month still occupies a column. Skipping its body
    // cell is precisely the old CSS-grid bug in table form.
    expect(code).toContain('col.kind === "month" ?');
    expect(code).toContain("styles.gridClosedCell");
  });
});

describe("the month grouping covers the window exactly", () => {
  // The arithmetic behind the colSpans. Nothing above can save a
  // header whose month weeks do not add up to the weeks the body
  // renders.
  const weeks: string[] = [];
  const d = new Date("2026-09-25T00:00:00Z");
  for (let i = 25; i >= 0; i -= 1) {
    const w = new Date(d);
    w.setUTCDate(w.getUTCDate() - 7 * i);
    weeks.push(w.toISOString().slice(0, 10));
  }

  it("sums each month's weeks back to the whole window", () => {
    const months = groupWeeksByMonth(weeks, "2026-09-25");
    const total = months.reduce((n, m) => n + m.weeks.length, 0);
    expect(total).toBe(weeks.length);
  });

  it("never emits an empty month", () => {
    // An empty month would render a colSpan of 0, which collapses the
    // header cell and shifts everything after it.
    const months = groupWeeksByMonth(weeks, "2026-09-25");
    expect(months.every((m) => m.weeks.length > 0)).toBe(true);
  });
});

describe("the pinned columns line up with their offsets", () => {
  function rule(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} not found`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  }

  it("offsets each pinned column by the widths before it", () => {
    // sticky `left` is absolute, not cumulative, so these three
    // numbers have to be kept in step by hand. Wrong, and two columns
    // sit on top of each other while a gap opens beside them.
    expect(rule(".gridPinArea")).toContain("left: 0");
    expect(rule(".gridPinArea")).toContain("width: 150px");
    expect(rule(".gridPinOwner")).toContain("left: 150px");
    expect(rule(".gridPinOwner")).toContain("width: 100px");
    expect(rule(".gridPinActions")).toContain("left: 250px");
    expect(rule(".gridPinActions")).toContain("width: 64px");
    expect(rule(".gridPinName")).toContain("left: 314px");
    expect(rule(".gridPinName")).toContain("width: 240px");
    expect(rule(".gridPinFreq")).toContain("left: 554px");
    expect(rule(".gridPinFreq")).toContain("width: 96px");
    // Target is pinned on purpose: it scrolled away with the weeks in
    // the first cut, and a grid of numbers with the target off-screen
    // is a grid of numbers you cannot read.
    expect(rule(".gridPinTarget")).toContain("left: 650px");
  });

  it("lets the measure name wrap rather than truncate", () => {
    // The name is the only thing on the row saying what is plotted,
    // and the part that gets cut is the part that tells one measure
    // from the next.
    const body = rule(".gridPinName");
    expect(body).not.toContain("text-overflow");
    expect(body).toContain("overflow-wrap");
  });

  it("scrolls the weeks without scrolling the page", () => {
    expect(rule(".gridScroll")).toContain("overflow-x: auto");
  });

  it("opens with the current month against the pinned columns", () => {
    // Not scrolled to the far right, which puts this week on screen
    // and leaves two or three collapsed months wedged between the
    // measure names and the weeks.
    const src2 = readFileSync(join(DIR, "MeasuresGrid.tsx"), "utf8");
    // Scrolled to the end, and IN A FRAME. Doing it on mount measures
    // a table the stylesheet has not finished sizing, so the scroll
    // clamps to a maximum that is about to change and the grid stops
    // short. That cost three rounds of chasing it as if it were a
    // column-width problem.
    expect(src2).toContain("requestAnimationFrame");
    expect(src2).toContain("el.scrollLeft = el.scrollWidth");
  });

  it("puts the drawer and its scrim above the navigation", () => {
    // The sidebar sits at 30, its mobile drawer at 40. A scrim below
    // those dims the table and leaves the rail bright, which reads as
    // a rendering fault rather than a focused panel.
    expect(rule(".drawerScrim")).toContain("z-index: 60");
    expect(rule(".drawer")).toContain("z-index: 61");
  });
});
