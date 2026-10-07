import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mondayOf, formatWeekBeginning } from "@/lib/dates";
import { monthKeyOf } from "./grid";
import { monthWeekLabel, weekLabel, weekOfMonth } from "./months";
import { isLastFridayOfMonth } from "./frequency";

// WEEKS ARE READ BY THE DAY THEY START ON, AND STORED BY THE DAY THEY
// END ON.
//
// Both of those are deliberate and they are not in tension. Every
// value, every target's effective_from, the Saturday sweep and the
// Friday nudge are keyed to the Friday, and Monday is Friday minus
// four — the two carry identical information. What changed on
// 2026-09-19 is only which one a person reads.
//
// So the storage is untouched, and what these pin is the boundary:
// the conversion, the one place the relabelling stops being cosmetic,
// and the rule that had to move with it.

describe("the Monday that opens a stored week", () => {
  it("is four days before the Friday", () => {
    expect(mondayOf("2026-09-18")).toBe("2026-09-14");
    expect(formatWeekBeginning("2026-09-18")).toBe("Sep 14");
  });

  it("crosses a month, and a year, without special-casing either", () => {
    expect(mondayOf("2026-10-02")).toBe("2026-09-28");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });
});

// ---- The one place it is not cosmetic ---------------------------
describe("a straddling week belongs to the month it begins in", () => {
  it("files the week ending 4 Sep under August", () => {
    // It begins Mon 31 Aug. Filed under September it would put "31"
    // under a September heading, which is the whole reason this
    // moved.
    expect(monthKeyOf("2026-09-04")).toBe("2026-08");
  });

  it("leaves a week wholly inside its month alone, which is most", () => {
    expect(monthKeyOf("2026-09-18")).toBe("2026-09");
    expect(monthKeyOf("2026-09-25")).toBe("2026-09");
  });

  it("agrees with the monthly due rule, which is the point", () => {
    // The column header and the chasing have to mean the same thing
    // by "September's last week", or the Saturday sweep asks for a
    // number in a month whose heading it is not under.
    //
    // September 2026's last week begins Mon 28 Sep and ends Fri 2 Oct.
    expect(isLastFridayOfMonth("2026-10-02")).toBe(true);
    expect(monthKeyOf("2026-10-02")).toBe("2026-09");
    // And the week before it is not the last one.
    expect(isLastFridayOfMonth("2026-09-25")).toBe(false);
    // August's last week ends on 4 Sep, and is filed under August.
    expect(isLastFridayOfMonth("2026-09-04")).toBe(true);
    expect(monthKeyOf("2026-09-04")).toBe("2026-08");
  });

  it("gives every month exactly one last week over a long run", () => {
    // A rule that can name two, or none, in some month would show up
    // as a monthly measure chased twice or never. Walk two years.
    const seen = new Map<string, number>();
    let friday = "2026-01-02"; // a Friday
    for (let i = 0; i < 104; i++) {
      if (isLastFridayOfMonth(friday)) {
        const key = monthKeyOf(friday);
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      const d = new Date(`${friday}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 7);
      friday = d.toISOString().slice(0, 10);
    }
    expect(seen.size).toBeGreaterThan(20);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });
});

// ---- What the page says -----------------------------------------
describe("the measures page reads in weeks beginning", () => {
  const ROOT = process.cwd();
  const grid = readFileSync(
    join(ROOT, "src/app/(app)/measures/MeasuresGrid.tsx"),
    "utf8"
  );
  const page = readFileSync(
    join(ROOT, "src/app/(app)/measures/page.tsx"),
    "utf8"
  );

  it("labels a column Week N of its month, not a date", () => {
    expect(grid).toContain("Week {weekOfMonth(w)}");
    expect(grid).not.toContain("mondayOf(w).slice(8)");
  });

  // The sentences name a week the way its column does (Jason,
  // 2026-10-06): "the week beginning Sep 28" sat above a grid calling
  // that week September's Week 4.
  it("names the week as its column does, in the hero, the count and each box", () => {
    expect(page).toContain("{weekLabel(weekEnding)} for the functions you lead");
    expect(grid).toContain("logged for ${weekLabel(chasedWeek)}");
    expect(grid).toContain("still to log for ${weekLabel(chasedWeek)}");
    expect(grid).toContain("`${row.description}, ${weekLabel(week)}`");
    expect(grid).not.toContain("formatWeekBeginning(");
    expect(page).not.toContain("formatWeekBeginning(");
  });

  it("no longer says 'week ending' anywhere a user reads", () => {
    for (const [name, src] of [
      ["MeasuresGrid", grid],
      ["page", page],
    ] as const) {
      // Comments explain the change and are allowed to name the old
      // wording; rendered strings are not.
      const code = src
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      expect(code, `${name} still renders "week ending"`).not.toMatch(
        /week ending/i
      );
    }
  });
});

describe("weekOfMonth", () => {
  // Keyed by the Friday; numbered by the Monday.
  it("numbers September 2026's weeks 1 to 4", () => {
    expect(weekOfMonth("2026-09-11")).toBe(1); // Mon 7 Sep
    expect(weekOfMonth("2026-09-18")).toBe(2); // Mon 14 Sep
    expect(weekOfMonth("2026-09-25")).toBe(3); // Mon 21 Sep
    expect(weekOfMonth("2026-10-02")).toBe(4); // Mon 28 Sep
  });
  it("starts again at 1 on the first Monday of the next month", () => {
    expect(weekOfMonth("2026-10-09")).toBe(1); // Mon 5 Oct
  });
});

describe("weekLabel", () => {
  it("names a week by its number in the month it begins in", () => {
    expect(weekLabel("2026-10-02")).toBe("Week 4 of September"); // Mon 28 Sep
    expect(weekLabel("2026-10-09")).toBe("Week 1 of October"); // Mon 5 Oct
    expect(weekLabel("2026-09-04")).toBe("Week 5 of August"); // Mon 31 Aug
  });
  it("crosses a year by the Monday, too", () => {
    expect(weekLabel("2027-01-01")).toBe("Week 4 of December"); // Mon 28 Dec 2026
  });
});

describe("monthWeekLabel", () => {
  // The Pull now list (Jason, 2026-10-06): "October Week 1", not the
  // Friday's date.
  it("names a week by its month and number, as the grid does", () => {
    expect(monthWeekLabel("2026-10-09")).toBe("October Week 1"); // Mon 5 Oct
    expect(monthWeekLabel("2026-10-02")).toBe("September Week 4"); // Mon 28 Sep
    expect(monthWeekLabel("2026-09-04")).toBe("August Week 5"); // Mon 31 Aug
  });
});
