import { describe, it, expect } from "vitest";
import { summarizeStrip, type StripRow, type StripCell } from "./grid-strip";
import { numbersToLog } from "./to-log";

// The strip above the /measures grid. Each count is over the rows the
// caller may log, in a week each is due, and nothing else.

const LAST = "2026-10-30";
const NOW = "2026-11-06";

function cell(
  weekEnding: string,
  expected: boolean,
  status: StripCell["status"] = "unlogged"
): StripCell {
  return { weekEnding, expected, status };
}

function row(id: string, last: StripCell, now: StripCell): StripRow {
  return { id, cells: [cell("2026-10-23", true), last, now] };
}

describe("summarizeStrip", () => {
  const rows: StripRow[] = [
    // Weekly, on target last week, nothing yet this week.
    row("a", cell(LAST, true, "good"), cell(NOW, true)),
    // Weekly, off target last week, entered this week.
    row("b", cell(LAST, true, "off"), cell(NOW, true, "good")),
    // Weekly, logged last week with no target to judge it by.
    row("c", cell(LAST, true, "no_target"), cell(NOW, true)),
    // Fortnightly: due last week, not this week. Nothing logged.
    row("d", cell(LAST, true), cell(NOW, false)),
    // Monthly outside its month's own week: due in neither.
    row("e", cell(LAST, false), cell(NOW, false)),
  ];
  const logged = new Set(["a|" + LAST, "b|" + LAST, "c|" + LAST, "b|" + NOW]);
  const counts = summarizeStrip(rows, {
    lastWeek: LAST,
    currentWeek: NOW,
    hasValue: (r, w) => logged.has(`${r.id}|${w}`),
  });

  it("counts last week over the rows due last week", () => {
    expect(counts.last).toEqual({ week: LAST, due: 4, logged: 3 });
  });

  it("counts this week over the rows due this week", () => {
    // d is in its off week and e is monthly: neither is owed.
    expect(counts.current).toEqual({ week: NOW, due: 3, entered: 1 });
  });

  it("judges on target from the cell's own status, ignoring rows with no target", () => {
    // a good, b off; c has no target and d has no value.
    expect(counts.onTargetLast).toEqual({ judged: 2, good: 1 });
  });

  it("lists every row missing a number in an open week it is due in", () => {
    // a and c owe this week; d owes last week. b is complete; e owes
    // nothing in either open week.
    expect(counts.needsNumber).toEqual(["a", "c", "d"]);
  });

  it("reads the live boxes it is handed, so a typed number counts at once", () => {
    const after = summarizeStrip(rows, {
      lastWeek: LAST,
      currentWeek: NOW,
      hasValue: (r, w) => logged.has(`${r.id}|${w}`) || (r.id === "d" && w === LAST),
    });
    expect(after.last?.logged).toBe(4);
    expect(after.needsNumber).toEqual(["a", "c"]);
  });

  it("says nothing about last week on a grid without one", () => {
    const only = summarizeStrip(rows, {
      lastWeek: null,
      currentWeek: NOW,
      hasValue: () => false,
    });
    expect(only.last).toBeNull();
    expect(only.onTargetLast).toBeNull();
    expect(only.needsNumber).toEqual(["a", "b", "c"]);
  });

  it("is empty for a caller with nothing to log", () => {
    const none = summarizeStrip([], {
      lastWeek: LAST,
      currentWeek: NOW,
      hasValue: () => false,
    });
    expect(none.last?.due).toBe(0);
    expect(none.current.due).toBe(0);
    expect(none.needsNumber).toEqual([]);
  });
});

describe("numbersToLog counts what the strip counts", () => {
  // My week's "3 of 4 still to log" and the grid's last-week chip are
  // one definition, asked of the server's values.
  it("agrees with the strip's last week", () => {
    const value = { number: 12, text: null };
    const mk = (
      id: string,
      expected: boolean,
      logged: boolean
    ) => ({
      id,
      cells: [
        { weekEnding: LAST, expected, status: logged ? "no_target" : "unlogged", value: logged ? value : null },
        { weekEnding: NOW, expected: true, status: "unlogged", value: null },
      ],
    });
    const grid = {
      previousWeekEnding: LAST,
      currentWeekEnding: NOW,
      groups: [
        { canLog: true, rows: [mk("a", true, true), mk("b", true, false), mk("c", false, false)] },
        // Somebody else's function: never counted.
        { canLog: false, rows: [mk("z", true, false)] },
      ],
    } as unknown as Parameters<typeof numbersToLog>[0];
    expect(numbersToLog(grid)).toEqual({ week: LAST, due: 2, outstanding: 1 });
  });
});
