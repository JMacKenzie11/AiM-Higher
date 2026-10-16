import { describe, it, expect } from "vitest";
import { isNeedsAttention } from "./needs-attention";

const THIS_FRIDAY = "2026-10-16";

describe("isNeedsAttention", () => {
  it("takes an open row from an earlier week", () => {
    expect(
      isNeedsAttention({ status: "open", week_ending: "2026-10-09" }, THIS_FRIDAY)
    ).toBe(true);
  });

  it("leaves an open row from this week, whatever day it was due", () => {
    // week_ending is this Friday even when the row was due on Monday.
    expect(
      isNeedsAttention({ status: "open", week_ending: THIS_FRIDAY }, THIS_FRIDAY)
    ).toBe(false);
  });

  it("leaves a resolved row from an earlier week", () => {
    for (const status of ["kept_on_time", "kept_late", "missed"] as const) {
      expect(
        isNeedsAttention({ status, week_ending: "2026-10-09" }, THIS_FRIDAY)
      ).toBe(false);
    }
  });

  it("leaves a row in a future week", () => {
    expect(
      isNeedsAttention({ status: "open", week_ending: "2026-10-23" }, THIS_FRIDAY)
    ).toBe(false);
  });
});
