import { describe, it, expect } from "vitest";

import { parseSheetNumber, parseSheetDate } from "./parse";

// The only place in this feature where a wrong answer is silent, so
// the cases below are mostly about what must be REFUSED. A parser
// that is willing to guess writes a plausible number onto a chart and
// nobody finds out.

describe("parseSheetNumber", () => {
  it("reads a plain number", () => {
    expect(parseSheetNumber("1234")).toEqual({ ok: true, value: 1234 });
    expect(parseSheetNumber("0")).toEqual({ ok: true, value: 0 });
    expect(parseSheetNumber("12.5")).toEqual({ ok: true, value: 12.5 });
  });

  it("reads a number the API handed back as a number", () => {
    expect(parseSheetNumber(42)).toEqual({ ok: true, value: 42 });
  });

  it("strips thousands separators", () => {
    expect(parseSheetNumber("1,234.56")).toEqual({ ok: true, value: 1234.56 });
    expect(parseSheetNumber("1 234")).toEqual({ ok: true, value: 1234 });
  });

  it("strips currency symbols", () => {
    expect(parseSheetNumber("$1,234.56")).toEqual({ ok: true, value: 1234.56 });
    expect(parseSheetNumber("£99")).toEqual({ ok: true, value: 99 });
  });

  it("DROPS a percent sign rather than dividing by a hundred", () => {
    // The platform stores a percent measure as 45, not 0.45. Reading
    // the formatted cell and dropping the sign is what keeps the
    // pulled value equal to the typed one; taking Sheets' underlying
    // value would silently divide every percent measure by 100.
    expect(parseSheetNumber("45%")).toEqual({ ok: true, value: 45 });
    expect(parseSheetNumber("99.5%")).toEqual({ ok: true, value: 99.5 });
  });

  it("reads accounting negatives", () => {
    expect(parseSheetNumber("(1,234)")).toEqual({ ok: true, value: -1234 });
    expect(parseSheetNumber("-3")).toEqual({ ok: true, value: -3 });
    // Both spellings at once still means negative once, not twice.
    expect(parseSheetNumber("(-3)")).toEqual({ ok: true, value: 3 });
  });

  it("refuses an empty cell rather than calling it zero", () => {
    // The whole of E4 in one assertion. A blank week must stay blank.
    expect(parseSheetNumber("").ok).toBe(false);
    expect(parseSheetNumber("   ").ok).toBe(false);
    expect(parseSheetNumber(null).ok).toBe(false);
    expect(parseSheetNumber(undefined).ok).toBe(false);
  });

  it("refuses text that merely contains digits", () => {
    // The manual entry path strips every non-digit, which turns
    // "3 of 5" into 35. This does not.
    expect(parseSheetNumber("3 of 5").ok).toBe(false);
    expect(parseSheetNumber("12a").ok).toBe(false);
    expect(parseSheetNumber("1.2.3").ok).toBe(false);
    expect(parseSheetNumber("N/A").ok).toBe(false);
    expect(parseSheetNumber("TBD").ok).toBe(false);
    expect(parseSheetNumber("—").ok).toBe(false);
  });

  it("refuses an unknown currency symbol rather than guessing", () => {
    expect(parseSheetNumber("₿100").ok).toBe(false);
  });

  it("quotes the offending cell in the reason", () => {
    const result = parseSheetNumber("N/A");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("N/A");
  });
});

describe("parseSheetDate", () => {
  it("reads ISO", () => {
    expect(parseSheetDate("2026-09-18")).toBe("2026-09-18");
  });

  it("reads US slashed dates, two-digit years included", () => {
    expect(parseSheetDate("9/18/2026")).toBe("2026-09-18");
    expect(parseSheetDate("09/18/26")).toBe("2026-09-18");
  });

  it("reads a Sheets serial date", () => {
    // 1899-12-30 is the epoch Sheets counts from.
    expect(parseSheetDate(46283)).toBe("2026-09-18");
  });

  it("refuses a date that does not exist", () => {
    expect(parseSheetDate("2026-02-30")).toBeNull();
    expect(parseSheetDate("13/01/2026")).toBeNull();
  });

  it("refuses prose rather than letting Date.parse guess", () => {
    // Date.parse would take several of these, with answers that
    // differ by runtime. An unrecognised key cell finds no row, which
    // declines the write — the safe direction.
    expect(parseSheetDate("Sep 18, 2026")).toBeNull();
    expect(parseSheetDate("Week 38")).toBeNull();
    expect(parseSheetDate("")).toBeNull();
    expect(parseSheetDate(null)).toBeNull();
  });
});
