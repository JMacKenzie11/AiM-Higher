import { describe, it, expect } from "vitest";

import {
  formatMeasureValue,
  toEntryNumber,
  toStoredNumber,
  parseScale,
  parseTypedNumber,
  scaleApplies,
} from "./value-format";

const v = (n: number) => ({ number: n, text: null });

// STORAGE IS ALWAYS THE TRUE NUMBER, and these are the two edges
// that translate. The round trip is the property that matters: what
// a person types, stored and read back, has to be what they typed.

describe("the two edges agree", () => {
  it("round-trips a typed figure through storage at every scale", () => {
    for (const [scale, typed] of [
      ["plain", 1234],
      ["thousands", 12.5],
      ["millions", 18],
      ["millions", 21.67],
    ] as const) {
      const stored = toStoredNumber(typed, "currency", scale);
      expect(toEntryNumber(stored, "currency", scale)).toBeCloseTo(typed, 6);
    }
  });

  it("stores the true number, not the typed one", () => {
    // The whole point. An external pull writes 18000000 directly and
    // needs no translation, because this is what a person typing 18
    // under millions produces too.
    expect(toStoredNumber(18, "currency", "millions")).toBe(18_000_000);
    expect(toStoredNumber(12.5, "number", "thousands")).toBe(12_500);
    expect(toStoredNumber(1234, "currency", "plain")).toBe(1234);
  });

  it("leaves percent and text alone, whatever the scale says", () => {
    // A percent in millions is not a thing. Rather than trusting the
    // UI to never offer it, the maths refuses to apply.
    expect(scaleApplies("percent")).toBe(false);
    expect(scaleApplies("text")).toBe(false);
    expect(toStoredNumber(13, "percent", "millions")).toBe(13);
  });
});

describe("how a value reads", () => {
  it("writes plain money with commas and no decimals", () => {
    // Asked for exactly: "$1,234 with no decimals".
    expect(formatMeasureValue("currency", "plain", v(1234))).toBe("$1,234");
    expect(formatMeasureValue("currency", "plain", v(1234.56))).toBe("$1,235");
    expect(formatMeasureValue("currency", "plain", v(627))).toBe("$627");
  });

  it("keeps the decimals that carry information at a scale", () => {
    // Production's backlog runs 13.2 to 21.67 in millions. Rounding
    // that to whole millions throws away the only variation there is,
    // which is why plain and scaled format differently on purpose.
    expect(formatMeasureValue("currency", "millions", v(21_670_000))).toBe(
      "$21.67M"
    );
    expect(formatMeasureValue("currency", "millions", v(18_000_000))).toBe(
      "$18M"
    );
    expect(formatMeasureValue("currency", "thousands", v(12_500))).toBe(
      "$12.5k"
    );
  });

  it("groups the big ones", () => {
    expect(formatMeasureValue("currency", "plain", v(1_234_567))).toBe(
      "$1,234,567"
    );
    expect(formatMeasureValue("number", "plain", v(45_000))).toBe("45,000");
  });

  it("puts a minus outside the symbol", () => {
    // -$400, not $-400.
    expect(formatMeasureValue("currency", "plain", v(-400))).toBe("-$400");
  });

  it("still formats the other three types as it always did", () => {
    // A plain NUMBER keeps its decimals. "no decimals" was asked for
    // about money; Days Sales Outstanding records 38.6 and rounding
    // it to 39 would destroy what somebody entered.
    expect(formatMeasureValue("percent", "plain", v(12.59))).toBe("12.59%");
    expect(formatMeasureValue("number", "plain", v(38.6))).toBe("38.6");
    expect(
      formatMeasureValue("text", "plain", { number: null, text: "Green" })
    ).toBe("Green");
  });

  it("renders nothing for a missing value, and says what nothing is", () => {
    expect(formatMeasureValue("currency", "plain", null)).toBe("");
    expect(formatMeasureValue("currency", "plain", null, "—")).toBe("—");
    expect(formatMeasureValue("currency", "plain", v(NaN))).toBe("");
  });
});

describe("what arrives from a form", () => {
  it("takes the symbols people type without arguing", () => {
    // A box that rejects a dollar sign on a currency measure is a box
    // arguing with its own label.
    expect(parseTypedNumber("$18")).toBe(18);
    expect(parseTypedNumber("1,234")).toBe(1234);
    expect(parseTypedNumber("21.67")).toBe(21.67);
    expect(parseTypedNumber("-400")).toBe(-400);
  });

  it("returns null rather than NaN for nothing usable", () => {
    expect(parseTypedNumber("")).toBeNull();
    expect(parseTypedNumber("   ")).toBeNull();
    expect(parseTypedNumber("abc")).toBeNull();
  });

  it("falls back to plain for an unknown scale", () => {
    // Anything else means a tampered or stale form, and plain is the
    // reading that cannot silently multiply somebody's number.
    expect(parseScale("millions")).toBe("millions");
    expect(parseScale("squillions")).toBe("plain");
    expect(parseScale(undefined)).toBe("plain");
    expect(parseScale(null)).toBe("plain");
  });
});
