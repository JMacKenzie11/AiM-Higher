import { describe, expect, it } from "vitest";
import { LIMITS, limitBroken } from "./limits";

const quiet = { lastMinute: 0, lastHour: 0 };

describe("rate limits", () => {
  it("lets a quiet person and company through", () => {
    expect(limitBroken(quiet, quiet)).toBeNull();
    expect(limitBroken(quiet, null)).toBeNull();
  });

  it("stops a person at their per-minute and per-hour limits", () => {
    expect(limitBroken({ lastMinute: LIMITS.person.perMinute - 1, lastHour: 0 }, null)).toBeNull();
    expect(limitBroken({ lastMinute: LIMITS.person.perMinute, lastHour: 0 }, null)).toBe("person_minute");
    expect(limitBroken({ lastMinute: 0, lastHour: LIMITS.person.perHour }, null)).toBe("person_hour");
  });

  it("stops a busy company even when this person is quiet", () => {
    expect(limitBroken(quiet, { lastMinute: LIMITS.company.perMinute, lastHour: 0 })).toBe("company_minute");
    expect(limitBroken(quiet, { lastMinute: 0, lastHour: LIMITS.company.perHour })).toBe("company_hour");
  });

  it("has no company limit for a call that names no company", () => {
    expect(limitBroken(quiet, null)).toBeNull();
  });
});
