import { describe, it, expect } from "vitest";
import {
  COMPANY_TIMEZONES,
  isValidCompanyTimezone,
  companyTimezoneLabel,
} from "./timezones";

describe("isValidCompanyTimezone", () => {
  it("accepts every value on the list", () => {
    for (const t of COMPANY_TIMEZONES) {
      expect(isValidCompanyTimezone(t.value)).toBe(true);
    }
  });

  it("rejects a zone that is real but not offered", () => {
    // Postgres would accept this happily, which is the point: the
    // guard is a product decision, not a syntax check.
    expect(isValidCompanyTimezone("Europe/London")).toBe(false);
  });

  // The next three are the reason this is an exact match rather than
  // a normalising one. Each would be "close enough" to accept, and
  // each writes a value that some other reader takes literally.
  it("rejects a value that differs only by case", () => {
    expect(isValidCompanyTimezone("america/anchorage")).toBe(false);
  });

  it("rejects a value with surrounding whitespace", () => {
    expect(isValidCompanyTimezone(" UTC ")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidCompanyTimezone("")).toBe(false);
  });
});

describe("companyTimezoneLabel", () => {
  it("labels a known zone", () => {
    expect(companyTimezoneLabel("America/Denver")).toBe(
      "America/Denver (Mountain)"
    );
  });

  it("falls back to the raw value for a zone set outside the app", () => {
    // A row edited by hand must render as what it actually is. Blank
    // or defaulted here is how a wrong clock stays invisible.
    expect(companyTimezoneLabel("Europe/London")).toBe("Europe/London");
  });
});

describe("COMPANY_TIMEZONES", () => {
  it("has no duplicate values", () => {
    const values = COMPANY_TIMEZONES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("uses no em-dashes in the labels", () => {
    // House rule: em-dashes are out of user-facing copy. These labels
    // carried them from Phase 2, when they lived inside the form.
    for (const t of COMPANY_TIMEZONES) {
      expect(t.label).not.toContain("—");
    }
  });
});
