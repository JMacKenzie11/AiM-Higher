import { describe, expect, it } from "vitest";
import { CHECKIN_MAX_BYTES, EMPTY_CHECKIN, checkCheckinDoc } from "./checkins";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("check-in notes", () => {
  it("saves a document as the editor writes it, and an empty one", () => {
    expect(checkCheckinDoc({ type: "doc", content: [para("Dana's daughter started school")] }).ok).toBe(true);
    expect(checkCheckinDoc(EMPTY_CHECKIN).ok).toBe(true);
    expect(checkCheckinDoc({ type: "doc" }).ok).toBe(true);
  });

  it("refuses anything that is not a document", () => {
    for (const v of [null, "notes", [], { type: "paragraph" }, { type: "doc", content: "x" }]) {
      expect(checkCheckinDoc(v).ok).toBe(false);
    }
  });

  it("refuses a document past the size the table allows, counted in bytes", () => {
    const big = { type: "doc", content: [para("é".repeat(CHECKIN_MAX_BYTES / 2))] };
    expect(JSON.stringify(big).length).toBeLessThan(CHECKIN_MAX_BYTES);
    expect(checkCheckinDoc(big).ok).toBe(false);
    expect(checkCheckinDoc({ type: "doc", content: [para("a".repeat(CHECKIN_MAX_BYTES - 200))] }).ok).toBe(true);
  });
});
