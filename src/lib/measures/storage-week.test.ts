import { describe, it, expect } from "vitest";

import { storageWeekFor, isLastFridayOfMonth } from "./frequency";
import { monthKeyOf } from "./grid";
import { mondayOf } from "@/lib/dates";

// WHERE A TYPED VALUE ACTUALLY LANDS.
//
// A monthly measure now offers a box in every week of its month, so
// somebody can put the number in whenever they have it. All of those
// boxes have to write to ONE week, and it has to be the week
// everything downstream already looks at — the Tuesday sweep, the
// dashboard board, the target history. None of them changes.
//
// That is the entire safety argument for the feature, so it is the
// thing pinned here.

describe("a monthly value lands on its month's own week", () => {
  it("sends every week of a month to the same place", () => {
    // September 2026: weeks begin Mon 7, 14, 21 and 28. The last of
    // those ends Friday 2 October, which is September's week.
    const sept = ["2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02"];
    const landed = sept.map((w) => storageWeekFor("monthly", w));
    expect(new Set(landed).size).toBe(1);
    expect(landed[0]).toBe("2026-10-02");
  });

  it("lands on a week that is genuinely that month's last", () => {
    // Not merely consistent — consistent AND correct. A rule that
    // always returned the first week of the year would pass the test
    // above.
    for (const w of ["2026-09-11", "2026-04-03", "2027-01-15"]) {
      const landed = storageWeekFor("monthly", w);
      expect(isLastFridayOfMonth(landed)).toBe(true);
      expect(monthKeyOf(landed)).toBe(monthKeyOf(w));
    }
  });

  it("never moves a value into a different month", () => {
    // Walk two years. If a week were ever sent to another month's
    // week, a January number would be filed as December and the sweep
    // would chase a month that was already reported.
    let week = "2026-01-02";
    for (let i = 0; i < 104; i += 1) {
      const landed = storageWeekFor("monthly", week);
      expect(
        monthKeyOf(landed),
        `${week} (begins ${mondayOf(week)}) landed in the wrong month`
      ).toBe(monthKeyOf(week));
      const d = new Date(`${week}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 7);
      week = d.toISOString().slice(0, 10);
    }
  });

  it("leaves weekly and fortnightly exactly where they were", () => {
    // The change must be invisible to every measure that is not
    // monthly, which is most of them.
    for (const w of ["2026-09-11", "2026-09-18", "2026-10-02"]) {
      expect(storageWeekFor("weekly", w)).toBe(w);
      expect(storageWeekFor("biweekly", w)).toBe(w);
    }
  });

  it("is idempotent, so the month's own week maps to itself", () => {
    // The box in the last week writes to the same place as the box in
    // the first. Without this, typing in the last column would send
    // the value a month forward.
    const own = storageWeekFor("monthly", "2026-09-11");
    expect(storageWeekFor("monthly", own)).toBe(own);
  });
});
