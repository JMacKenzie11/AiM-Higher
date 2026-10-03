import { describe, it, expect } from "vitest";
import { weekEndingOfInstant } from "./dates";

// Weeks run Saturday to Friday and are stored by their Friday. A moment
// belongs to the week of the company's own calendar date.
describe("weekEndingOfInstant", () => {
  it("puts Friday evening in Halifax in that Friday's week, though it is Saturday in UTC", () => {
    // 2026-10-02 23:00 in Halifax (UTC-3) is 2026-10-03 02:00 UTC.
    expect(weekEndingOfInstant("2026-10-03T02:00:00Z", "America/Halifax")).toBe("2026-10-02");
    expect(weekEndingOfInstant("2026-10-03T02:00:00Z", "UTC")).toBe("2026-10-09");
  });

  it("starts a new week on Saturday, the platform's own rule", () => {
    expect(weekEndingOfInstant("2026-10-03T15:00:00Z", "America/Halifax")).toBe("2026-10-09");
  });

  it("takes a Date as well as a string, and refuses something that is not a moment", () => {
    expect(weekEndingOfInstant(new Date("2026-09-28T12:00:00Z"), "America/Anchorage")).toBe("2026-10-02");
    expect(() => weekEndingOfInstant("not a date", "UTC")).toThrow("Not a moment in time");
  });
});
