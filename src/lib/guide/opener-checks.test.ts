import { describe, it, expect } from "vitest";
import { checkOpener, faultCount, openerRetryInstruction } from "./opener-checks";

describe("checkOpener", () => {
  it("finds the banned phrases in a real generated opener", () => {
    const f = checkOpener(
      'Third week running for that Tuesday collision, and this time it stopped at the real gap instead of another patch. You were in the room for that one.'
    );
    expect(f.banned.map((h) => h.phrase)).toEqual(expect.arrayContaining(["the room", "X instead of Y"]));
  });

  it("counts two questions joined by and as a fault, and says what to do", () => {
    const f = checkOpener(
      "You're carrying two pieces of the margin picture now. How's the margin model coming, and did the supplier pricing data you need actually show up?"
    );
    expect(f.joined).toHaveLength(1);
    expect(openerRetryInstruction(f)).toContain("Ask one question");
  });

  it("passes a clean opener", () => {
    expect(faultCount(checkOpener("Your team agreed the crew would hear about the credit. Who tells the crew?"))).toBe(0);
  });
});
