import { describe, it, expect } from "vitest";
import { checkEntryWeek, isEntryWeekOpen } from "./entry-window";

// The week rule the grid opens its boxes by and the server checks
// before writing a value. Friday 16 October 2026 is "this week".
const NOW = "2026-10-16";
const OLD = "2025-01-01T00:00:00Z";
const open = (frequency: "weekly" | "biweekly" | "monthly", week: string, isAdmin = false, currentWeek = NOW) =>
  isEntryWeekOpen({ frequency, week, currentWeek, isAdmin });

describe("isEntryWeekOpen", () => {
  it("opens this week and the week that just closed to everyone", () => {
    expect(open("weekly", "2026-10-16")).toBe(true);
    expect(open("weekly", "2026-10-09")).toBe(true);
    expect(open("weekly", "2026-10-02")).toBe(false);
  });

  it("opens any week of the drawn year to an admin, and nothing later or earlier", () => {
    expect(open("weekly", "2026-10-02", true)).toBe(true);
    expect(open("weekly", "2025-10-24", true)).toBe(true); // the oldest column
    expect(open("weekly", "2025-10-17", true)).toBe(false);
    expect(open("weekly", "2026-10-23", true)).toBe(false); // next week
  });

  it("only ever opens a Friday", () => {
    expect(open("weekly", "2026-10-15", true)).toBe(false);
    expect(open("weekly", "not-a-date", true)).toBe(false);
  });

  it("opens a monthly measure for its whole month", () => {
    // October's own week ends Fri 30 October; any October box is open.
    expect(open("monthly", "2026-10-09")).toBe(true);
    expect(open("monthly", "2026-10-30")).toBe(true);
    // September's own week (ending Fri 2 October) is past the window.
    expect(open("monthly", "2026-10-02")).toBe(false);
    expect(open("monthly", "2026-10-02", true)).toBe(true);
  });

  it("keeps last month open after month end while its own week is in the window", () => {
    expect(open("monthly", "2026-09-18", false, "2026-10-09")).toBe(true);
    expect(open("monthly", "2026-08-21", false, "2026-10-09")).toBe(false);
  });
});

describe("checkEntryWeek", () => {
  const check = (over: Partial<Parameters<typeof checkEntryWeek>[0]>) =>
    checkEntryWeek({ frequency: "weekly", week: NOW, currentWeek: NOW, isAdmin: false, createdAt: OLD, ...over });

  it("writes a weekly value to the week it was entered for", () => {
    expect(check({})).toEqual({ ok: true, storageWeek: NOW });
  });

  it("writes a monthly value to its month's own week, whichever week it was typed in", () => {
    expect(check({ frequency: "monthly", week: "2026-10-09" })).toEqual({ ok: true, storageWeek: "2026-10-30" });
  });

  it("says why it refuses", () => {
    expect(check({ week: "2026-10-15" })).toEqual({ ok: false, message: "Weeks are recorded by the Friday they end on." });
    expect(check({ week: "2026-10-02" })).toEqual({
      ok: false,
      message: "Only this week and last week are open. An admin can change an older week.",
    });
    expect(check({ week: "2025-10-17", isAdmin: true })).toEqual({
      ok: false,
      message: "That week is outside the year the measures page shows.",
    });
  });

  it("refuses a week the measure is not due", () => {
    // A monthly measure created in October owes nothing for September,
    // whose own week (ending 2 October) is before it existed. (A weekly
    // measure is due every week, as the grid has always drawn it.)
    expect(
      check({ frequency: "monthly", week: "2026-10-02", currentWeek: "2026-10-09", createdAt: "2026-10-06T09:00:00Z" })
    ).toEqual({ ok: false, message: "That measure isn't due that week." });
    // Every other week from the week ending 2 October: the 16th, not the 9th.
    expect(check({ frequency: "biweekly", week: "2026-10-09", createdAt: "2026-09-30T00:00:00Z" }).ok).toBe(false);
    expect(check({ frequency: "biweekly", week: "2026-10-16", createdAt: "2026-09-30T00:00:00Z" }).ok).toBe(true);
  });
});
