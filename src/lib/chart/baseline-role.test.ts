import { describe, it, expect } from "vitest";
import {
  BASELINE_ROLE,
  isBaselineRole,
  withoutBaselineRole,
} from "./baseline-role";

describe("the baseline role matcher", () => {
  it("matches the exact string the trigger writes", () => {
    expect(isBaselineRole(BASELINE_ROLE)).toBe(true);
  });

  it("matches the line the model actually emitted", () => {
    // Verbatim from a Howard Concrete proposal.
    expect(
      isBaselineRole(
        "Leadership, Management, and Accountability (LMA) for the sales and marketing function"
      )
    ).toBe(true);
    expect(
      isBaselineRole(
        "Leadership, Management, and Accountability (LMA) for finance, HR, and admin"
      )
    ).toBe(true);
  });

  it("matches the spellings a model drifts into", () => {
    for (const s of [
      "LMA",
      "LTD",
      "Lead, Track and Decide",
      "Lead / Track / Decide",
      "LEAD, TRACK, DECIDE",
      "Lead, Track, Decide for operations",
      "Leadership, Management and Accountability",
    ]) {
      expect(isBaselineRole(s), s).toBe(true);
    }
  });

  it("does not match a real responsibility that merely starts with a word", () => {
    for (const s of [
      "Lead generation",
      "Leadership development programme",
      "Tracking job costs",
      "Decide on supplier contracts",
      "Business development and lead generation",
      "Ltda partnership filings",
    ]) {
      expect(isBaselineRole(s), s).toBe(false);
    }
  });

  it("strips every baseline entry and keeps the rest in order", () => {
    expect(
      withoutBaselineRole([
        "Leadership, Management, and Accountability (LMA) for sales",
        "Business development",
        "Estimating and bid preparation",
      ])
    ).toEqual(["Business development", "Estimating and bid preparation"]);
  });

  it("strips it wherever it lands, not just first", () => {
    // The prompt says first. The model is not a contract.
    expect(
      withoutBaselineRole(["Pipeline", "LMA", "Forecasting"])
    ).toEqual(["Pipeline", "Forecasting"]);
  });

  it("leaves a list with no baseline entry untouched", () => {
    const list = ["Pipeline", "Forecasting"];
    expect(withoutBaselineRole(list)).toEqual(list);
  });
});
