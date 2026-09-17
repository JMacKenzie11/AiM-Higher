import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { shouldCritiqueOnBlur } from "./critique-blur";

// Save and Cancel needed clicking twice on both measure forms.
//
// The critique ran on blur, which re-rendered the form, which made
// the critique panel appear ABOVE the button row and pushed the
// buttons down between mousedown and mouseup. The pointer was no
// longer over the button when the click completed.
//
// There is no DOM in this test environment, so the click itself
// cannot be reproduced here. What can be pinned is the rule that
// stops the re-render, and that both forms actually use it — which is
// the half that would silently come undone, because the forms work
// fine without it right up until somebody clicks a button.

const el = (tagName: string) =>
  ({ relatedTarget: { tagName } }) as unknown as Parameters<
    typeof shouldCritiqueOnBlur
  >[0];

describe("shouldCritiqueOnBlur", () => {
  it("does NOT critique when focus moves to a button", () => {
    // Save and Cancel. The person has stopped writing, so the result
    // would be discarded with the form a moment later anyway.
    expect(shouldCritiqueOnBlur(el("BUTTON"))).toBe(false);
  });

  it("still critiques when moving between fields", () => {
    expect(shouldCritiqueOnBlur(el("INPUT"))).toBe(true);
    expect(shouldCritiqueOnBlur(el("SELECT"))).toBe(true);
    expect(shouldCritiqueOnBlur(el("TEXTAREA"))).toBe(true);
  });

  it("still critiques when there is no new focus target", () => {
    // The window losing focus, or a click on something unfocusable.
    // Ordinary blurs, and the behaviour that was there before.
    expect(
      shouldCritiqueOnBlur({ relatedTarget: null } as unknown as Parameters<
        typeof shouldCritiqueOnBlur
      >[0])
    ).toBe(true);
  });
});

// ---- Both forms have to actually use it -------------------------
//
// The rule above is inert unless it is wired in, and a blur handler
// that ignores its event looks completely normal. Read from source,
// like grid-alignment.test.ts, because these are client components
// with no DOM to render them into.
describe("both measure forms guard the blur", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const forms = [
    "src/app/(app)/measures/ManagedMeasureRow.tsx",
    "src/app/(app)/chart/function/[id]/AddMetricRow.tsx",
  ];

  for (const form of forms) {
    const src = readFileSync(path.join(ROOT, form), "utf8");
    const name = form.split("/").pop();

    it(`${name} passes the blur event to the critique`, () => {
      // The specific regression: `onBlur={runAiCritique}` drops the
      // event, the guard can never fire, and the double-click comes
      // back.
      expect(src).not.toMatch(/onBlur=\{runAiCritique\}/);
      expect(src).toMatch(/onBlur=\{\(e\) => runAiCritique\(e\)\}/);
    });

    it(`${name} bails when the guard says so`, () => {
      expect(src).toContain("shouldCritiqueOnBlur");
      expect(src).toMatch(
        /if\s*\(event\s*&&\s*!shouldCritiqueOnBlur\(event\)\)\s*return;/
      );
    });
  }
});
