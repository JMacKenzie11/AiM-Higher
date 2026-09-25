import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/transcripts/analyze", () => ({ analyzeMeeting: vi.fn() }));
vi.mock("@/lib/instances/registry", () => ({ lookupInstance: vi.fn() }));

import { diffRows, isUntouched } from "./resummarize-once";

// The comparison that decides "nobody's work was touched".
describe("diffRows", () => {
  const before = [
    { id: "c1", updated_at: "2026-09-24T10:00:00Z" },
    { id: "c2", updated_at: "2026-09-24T11:00:00Z" },
  ];

  it("passes the same rows at the same times", () => {
    expect(isUntouched(diffRows(before, [...before].reverse()))).toBe(true);
  });

  it("catches a row rewritten in place, not only a changed set of ids", () => {
    const d = diffRows(before, [before[0], { id: "c2", updated_at: "2026-09-25T09:00:00Z" }]);
    expect(d).toEqual({ added: [], removed: [], changed: ["c2"] });
    expect(isUntouched(d)).toBe(false);
  });

  it("catches a deletion and a recreation under a new id", () => {
    // Exactly what the old Reanalyze did.
    const d = diffRows(before, [before[0], { id: "c3", updated_at: "2026-09-25T09:00:00Z" }]);
    expect(d.removed).toEqual(["c2"]);
    expect(d.added).toEqual(["c3"]);
  });
});
