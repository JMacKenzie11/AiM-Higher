import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The page must not scroll sideways, and the grid must not force it to.
//
// ---- WHAT WENT WRONG ------------------------------------------
//
// On an iPhone the whole PAGE scrolled left and right. Not the grid
// inside its card: the page, hero and all. And the add/edit drawer,
// which is `position: fixed; right: 0`, rendered with its first 16px
// off the left edge of the screen, so every label was clipped.
//
// The two were one bug wearing two hats. `right: 0` on a fixed
// element resolves against the initial containing block, which is as
// wide as the DOCUMENT, not the window. Widen the document by 16px
// and every right-anchored panel in the app moves 16px off-screen.
//
// There were two separate sources of that extra width:
//
//   1. THE APP FRAME. `.main` pads the page by --space-6, and
//      PageShell's `.stage` cancels it with a matching negative
//      margin so the gradient hero can reach the window edges. On a
//      phone `.main` drops to --space-4 and the negative margin did
//      not: 24px of pull against 16px of padding, 8px a side, on
//      every page in the app.
//
//   2. THE GRID. The pinned block is about 770px wide. The drawn
//      scrollbar is inset by that much so it sits over the part of
//      the table that actually moves, which on a 393px viewport put
//      its right-hand arrow at x=828 and dragged the document out
//      with it.
//
// ---- WHAT IS PINNED HERE --------------------------------------
//
// Source shape, not rendered geometry: these are CSS files and a
// client component, and nothing here runs a browser. The rendered
// result was measured separately (four pages at scrollWidth ==
// clientWidth == 393, drawer at left 0 right 393). What these tests
// catch is the edit that quietly breaks it again, which for #1 is
// somebody changing one of the two numbers that have to agree.

const ROOT = process.cwd();
const frame = readFileSync(join(ROOT, "src/app/(app)/layout.module.css"), "utf8");
const shell = readFileSync(
  join(ROOT, "src/components/ui/PageShell.module.css"),
  "utf8"
);
const grid = readFileSync(
  join(ROOT, "src/app/(app)/measures/MeasuresGrid.tsx"),
  "utf8"
);
const css = readFileSync(
  join(ROOT, "src/app/(app)/measures/measures.module.css"),
  "utf8"
);

describe("the hero's bleed cancels the frame's gutter exactly", () => {
  it("publishes the gutter as a custom property rather than a literal", () => {
    // The fix is that there is now ONE number. Both the padding and
    // the negative margin read it, so a future change to the mobile
    // padding cannot leave the bleed behind.
    expect(frame).toMatch(/--page-gutter:\s*var\(--space-6\)/);
    expect(frame).toMatch(/padding:\s*var\(--space-6\)\s+var\(--page-gutter\)/);
  });

  it("redefines it for the phone, where the padding is smaller", () => {
    const mobile = frame.slice(frame.indexOf("@media (max-width: 768px)"));
    expect(mobile).toMatch(/--page-gutter:\s*var\(--space-4\)/);
    expect(mobile).toMatch(/padding:\s*var\(--space-5\)\s+var\(--page-gutter\)/);
  });

  it("pulls the stage out by that property, not by a hard-coded space", () => {
    // Top pull stays a plain token: it cancels `.main`'s VERTICAL
    // padding, which does not change with the viewport. The two
    // horizontal ones are the gutter, and are the pair that drifted.
    // The fallback keeps PageShell honest anywhere --page-gutter is
    // not in scope, which is the behaviour it had before.
    expect(shell).toMatch(
      /margin:\s*calc\(-1 \* var\(--space-6\)\)\s+calc\(-1 \* var\(--page-gutter,\s*var\(--space-6\)\)\)\s+0;/
    );
  });
});

describe("the grid gives up pinning when there is no room for it", () => {
  it("measures the room and stops the pinned loop when it runs out", () => {
    expect(grid).toMatch(/const roomToPin = el\.clientWidth - \d+/);
    expect(grid).toMatch(/if \(pinnedRight > roomToPin\) break/);
  });

  it("zeroes the offset, so nothing downstream is inset by a phantom block", () => {
    // The scrollbar row's margin-left is pinnedRight. If that stays
    // at ~770 while the columns are no longer sticky, the row alone
    // reopens the page-level overflow.
    expect(grid).toMatch(/const pinning = pinnedRight <= roomToPin/);
    expect(grid).toMatch(/if \(!pinning\) pinnedRight = 0/);
    expect(grid).toMatch(/row\.style\.marginLeft = `\$\{pinnedRight\}px`/);
  });

  it("tells the stylesheet, which unsticks the columns", () => {
    expect(grid).toMatch(/el\.dataset\.pinned = pinning \? "true" : "false"/);
    expect(css).toMatch(
      /\.gridScroll\[data-pinned="false"\]\s+\.gridPin\s*\{[^}]*position:\s*static/
    );
  });

  it("opens on the names rather than the far right when nothing is pinned", () => {
    // Scrolled to the end with no sticky name column, the first thing
    // on screen is a column of numbers with no row labels anywhere.
    expect(grid).toMatch(/el\.scrollLeft = pinning \? el\.scrollWidth : 0/);
  });
});

describe("the grid's own scroll container is allowed to be narrower than its table", () => {
  it("clears min-width: auto on both flex items", () => {
    // A flex item defaults to min-width: auto, which for a scroll
    // container resolves to its min-content width. Without this the
    // card simply refuses to shrink below the table and the page
    // scrolls instead of the grid.
    for (const selector of [".gridStack {", ".gridScroll {"]) {
      const start = css.indexOf(selector);
      expect(start, `${selector} not found`).toBeGreaterThan(-1);
      expect(css.slice(start, css.indexOf("}", start))).toContain("min-width: 0");
    }
  });
});
