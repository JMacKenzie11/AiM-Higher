import { describe, it, expect } from "vitest";
import { planSfaReorder } from "./sfa-order";

describe("planSfaReorder", () => {
  it("numbers a list that has never been ordered (every row at 0)", () => {
    // B&B Electric, 2026-11-12: two areas, both 0, shown by creation
    // date. Swapping two zeros would change nothing.
    const out = planSfaReorder(
      [
        { id: "sfa2", sort_order: 0 },
        { id: "sfa1", sort_order: 0 },
      ],
      ["sfa1", "sfa2"]
    );
    expect(out).toEqual([{ id: "sfa2", sort_order: 1 }]);
  });

  it("writes only the rows whose number changes", () => {
    const out = planSfaReorder(
      [
        { id: "a", sort_order: 0 },
        { id: "b", sort_order: 1 },
        { id: "c", sort_order: 2 },
      ],
      ["a", "c", "b"]
    );
    expect(out).toEqual([
      { id: "c", sort_order: 1 },
      { id: "b", sort_order: 2 },
    ]);
  });

  it("writes nothing for an order that already holds", () => {
    const out = planSfaReorder(
      [
        { id: "a", sort_order: 0 },
        { id: "b", sort_order: 1 },
      ],
      ["a", "b"]
    );
    expect(out).toEqual([]);
  });

  it("ignores an id it was given no row for", () => {
    const out = planSfaReorder([{ id: "a", sort_order: 5 }], ["zz", "a"]);
    expect(out).toEqual([{ id: "a", sort_order: 1 }]);
  });
});
