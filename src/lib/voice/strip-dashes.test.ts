import { describe, it, expect } from "vitest";
import { stripEmDashes } from "./strip-dashes";

// The five real ones, taken from a summary the model produced with
// the ban already in its prompt.
describe("stripEmDashes", () => {
  it("turns a bolded label and its explanation into a colon", () => {
    expect(
      stripEmDashes(
        "- **Bad news travels fast** — E2E Function Lead raised the credit unprompted."
      )
    ).toBe(
      "- **Bad news travels fast**: E2E Function Lead raised the credit unprompted."
    );
  });

  it("turns a mid-sentence aside into commas", () => {
    expect(
      stripEmDashes("The crew — Ray's crew — had it done in one day.")
    ).toBe("The crew, Ray's crew, had it done in one day.");
  });

  it("turns a single dash between words into a comma", () => {
    expect(stripEmDashes("It was late — again.")).toBe("It was late, again.");
  });

  it("never substitutes a hyphen", () => {
    // The substitution people reach for first, and it reads worse
    // than either alternative.
    expect(stripEmDashes("The crew — and Ray — finished.")).not.toContain(" - ");
  });

  it("drops a dash that punctuates nothing", () => {
    expect(stripEmDashes("Nothing to add —")).toBe("Nothing to add");
    expect(stripEmDashes("— and that was that")).toBe("and that was that");
  });

  it("handles a dash with no spaces around it", () => {
    expect(stripEmDashes("revenue—margin tradeoff")).toBe(
      "revenue, margin tradeoff"
    );
  });

  it("leaves clean text untouched, and returns the same string", () => {
    const clean = "## Decisions\n\nThe pricing review moves to next month.\n";
    expect(stripEmDashes(clean)).toBe(clean);
  });

  it("leaves hyphens and minus signs alone", () => {
    expect(stripEmDashes("a well-run check-in, down 3-4 points")).toBe(
      "a well-run check-in, down 3-4 points"
    );
  });

  it("clears every dash from a whole section", () => {
    const real = [
      "**Where values showed up**",
      "- **Own it out loud** — the answer was immediate.",
      "- **Fix the cause** — the team moved from patching to a durable fix.",
      "",
      "Speaker 2 raised it — unprompted — mid-meeting.",
    ].join("\n");
    expect(stripEmDashes(real)).not.toMatch(/[—–]/);
  });
});
