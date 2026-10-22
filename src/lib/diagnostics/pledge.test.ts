import { describe, it, expect } from "vitest";
import { draftPledge } from "./pledge";

describe("draftPledge", () => {
  it("is in the owner's voice, names the destination, and makes the promise", () => {
    const text = draftPledge({ ownerName: "Pat Moreau", leadName: "Jason", destination: "faster quoting." });
    expect(text).toContain("Nobody loses their job because of this.");
    expect(text).toContain("goes first to faster quoting.");
    expect(text).toContain("conversation with Jason");
    expect(text.endsWith("Pat")).toBe(true);
    expect(text).not.toMatch(/[–—]/);
  });

  it("leaves the destination out until there is one", () => {
    expect(draftPledge({ ownerName: null, leadName: "Jason", destination: " " })).not.toContain("goes first to");
  });
});
