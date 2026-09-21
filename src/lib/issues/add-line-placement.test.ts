import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// THE ADD LINE MUST NOT BE PLACED BY COUNTING ITS CHILDREN.
//
// ---- the incident ----------------------------------------------
//
// `.addLine` (the "add a commitment" form inside an issue) composes
// `row rowNoPriority` from commitments.module.css. At <= 1024px that
// stylesheet lays a row out with named areas and assigns them by
// position:
//
//     .row > :nth-child(1) { grid-area: circle }      ... through (8)
//
// which is safe only if you know how many children the form has.
// Both files carried a comment saying it had three: the hidden
// issue_id, owner_id and due_date inputs before the first real cell.
//
// It has SEVEN. Three are written in the JSX; the rest are added by
// React to a <form action={serverAction}> to encode the server-action
// reference. Every nth-child rule then landed on a hidden input, the
// textarea fell through to :nth-child(8) and took `grid-area: status`,
// and the select, date and button fell off the end of the rules and
// kept their desktop `grid-column: 5`, `6`, `7` — columns a
// four-column grid does not have.
//
// On the production build at 393px:
//
//     grid-template-columns: 40px 40px 40px 0px 2px 0px 51px
//     textarea  w=18  h=565   "What will we do this week?"
//
// The description track crushed to zero and its placeholder rendered
// one letter per line, on every issue, for every Benson user on a
// phone.
//
// ---- why this is a source test ----------------------------------
//
// Because a browser test cannot see the RULE, only its effect on
// whatever page it happens to load. This one asserts the rule: as
// long as commitments.module.css places row cells by :nth-child,
// this file must release .addLine's children from that placement at
// the same width. e2e/issues-add-line.spec.ts covers the rendered
// result; this covers the reason.
//
// If you are here because this test failed, the fix is not a better
// count. It is to keep the add line out of the counting.

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const COMMITMENTS = "src/app/(app)/commitments/commitments.module.css";
const ISSUES = "src/app/(app)/issues/issues.module.css";

// The @media block whose selector text contains `needle`.
function mediaBlockContaining(css: string, needle: string): string | null {
  let i = 0;
  while (true) {
    const start = css.indexOf("@media", i);
    if (start === -1) return null;
    let depth = 0;
    let j = css.indexOf("{", start);
    if (j === -1) return null;
    const open = j;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const block = css.slice(start, j + 1);
    if (block.includes(needle)) return block;
    i = open + 1;
  }
}

describe("the issues add line is not placed by child count", () => {
  it("commitments still places row cells by :nth-child (the hazard)", () => {
    // If this ever stops being true the guard below is pointless and
    // should be deleted rather than left passing for the wrong reason.
    expect(read(COMMITMENTS)).toMatch(/\.row\s*>\s*:nth-child\(\d\)/);
  });

  it("issues releases .addLine's children from it", () => {
    const block = mediaBlockContaining(read(ISSUES), ".addLine");
    expect(block, ".addLine has no mobile block at all").not.toBeNull();
    // grid-area, not grid-column: nth-child assigns a named AREA,
    // which sets the row as well as the column. Releasing only the
    // column leaves the textarea stuck on the status row.
    expect(block).toMatch(/\.addLine\s*>\s*\*\s*\{[^}]*grid-area:\s*auto/);
  });

  it("releases it with enough weight to win", () => {
    // `.row > :nth-child(n)` is two classes' worth of specificity;
    // `.addLine > *` is one. Without !important the release loses and
    // the page looks exactly as broken as before.
    const block = mediaBlockContaining(read(ISSUES), ".addLine")!;
    const rule = block.match(/\.addLine\s*>\s*\*\s*\{[^}]*\}/)![0];
    expect(rule).toMatch(/grid-area:\s*auto\s*!important/);
  });

  it("gives the released children a column to fall into", () => {
    // Releasing the placement is only half of it. Without collapsing
    // the template the children auto-place into the three 40px circle
    // tracks, and a textarea in a 40px track is the same bug wearing
    // a different hat.
    const block = mediaBlockContaining(read(ISSUES), ".addLine")!;
    const rule = block.match(/\.addLine\s*\{[^}]*\}/)![0];
    expect(rule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule).toMatch(/grid-template-areas:\s*none/);
  });

  it("covers the width at which commitments starts counting", () => {
    // The release has to begin no later than the placement does, or
    // there is a band of widths where the form is broken.
    const placed = mediaBlockContaining(read(COMMITMENTS), ".row > :nth-child(1)")!;
    const released = mediaBlockContaining(read(ISSUES), ".addLine")!;
    const px = (b: string) => Number(b.match(/max-width:\s*(\d+)px/)![1]);
    expect(px(released)).toBeGreaterThanOrEqual(px(placed));
  });
});
