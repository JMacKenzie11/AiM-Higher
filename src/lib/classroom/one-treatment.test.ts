import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// EVERY PHASE RENDERS THE SAME WAY.
//
// The classroom used to have two treatments. Phase 1 was a numbered
// sequence — heading, count badge, ordered list. Everything else was
// flattened into one grid of bordered cards with a blue accent bar,
// no numbers, and no category heading at all, so Phase 2 and Phase 3
// ran together with nothing marking where one ended.
//
// The reasoning was that later phases were "a library, not a
// sequence". They are not: Phase 2 is Build the Shared Identity →
// Create the Vision → Open Your Next Quarter → Continue Your Weekly
// Rhythm, which is as ordered as Phase 1.
//
// This is a source test because the repo has no DOM environment —
// vitest runs in node and there is no testing-library — and because
// what matters is structural: that ONE path renders all of them. A
// second path is exactly how the two drifted apart in the first
// place, and it is visible in the source long before it is visible
// on the page.

const PAGE = path.resolve(
  __dirname,
  "../../app/(app)/classroom/page.tsx"
);
const CSS = path.resolve(
  __dirname,
  "../../app/(app)/classroom/classroom.module.css"
);

const page = () => readFileSync(PAGE, "utf8");

// Comments talk ABOUT the old behaviour on purpose — the history is
// why the rule exists. Assertions about what the page DOES have to
// read the code, or the explanation trips the test that the
// explanation is there to support.
const code = () =>
  page()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
const css = () => readFileSync(CSS, "utf8");

describe("the classroom landing has one treatment", () => {
  it("renders every phase through a single map", () => {
    expect(code()).toMatch(/phases\.map\(/);
  });

  it("no longer singles out one category by name", () => {
    // The old rule compared a category's name to the literal
    // "phase 1", so renaming the category in /admin/classroom
    // silently changed how it rendered.
    const src = code();
    expect(src).not.toMatch(/name\.trim\(\)\.toLowerCase\(\)\s*===/);
    expect(src).not.toContain("SEQUENCE_CATEGORY");
    expect(src.toLowerCase()).not.toContain('"phase 1"');
  });

  it("does not render a second, card-grid treatment", () => {
    for (const cls of ["lessonGrid", "lessonCard", "lessonTitle"]) {
      expect(code(), `${cls} is back in the page`).not.toContain(cls);
    }
  });

  it("drops the grid's styles rather than leaving them for reuse", () => {
    // Left in the stylesheet they are an invitation to render the
    // second treatment again.
    for (const cls of [".lessonGrid {", ".lessonCard {", ".lessonTitle {"]) {
      expect(css(), `${cls} is still defined`).not.toContain(cls);
    }
  });

  it("still gives each phase its heading, its count and its numbers", () => {
    const src = code();
    expect(src).toContain("sequenceTitle");
    expect(src).toContain("sequenceBadge");
    expect(src).toContain("sequenceIndex");
    // A heading needs something to label, and aria-labelledby needs
    // an id unique per section — a fixed one would point every
    // section at the first heading.
    expect(src).toMatch(/classroom-phase-\$\{/);
  });

  it("skips a category with no lessons", () => {
    // A heading, a "0 trainings" badge and nothing underneath reads
    // as something failing to load.
    expect(code()).toMatch(/lessons\.length > 0/);
  });
});
