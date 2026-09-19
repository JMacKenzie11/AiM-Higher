import { describe, it, expect } from "vitest";

import {
  buildGridData,
  cellStatus,
  groupWeeksByMonth,
  monthKeyOf,
  monthLabel,
} from "./grid";
import type { MeasuresSpine } from "./spine";

// The six-month grid: what is shown, where, and what a blank means.

const THIS_FRIDAY = "2026-09-25";

// 26 Fridays ending 2026-09-25.
function weeksTo(end: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(`${end}T00:00:00Z`);
  for (let i = count - 1; i >= 0; i -= 1) {
    const w = new Date(d);
    w.setUTCDate(w.getUTCDate() - 7 * i);
    out.push(w.toISOString().slice(0, 10));
  }
  return out;
}
const WEEKS = weeksTo(THIS_FRIDAY, 26);

function spine(over: Partial<MeasuresSpine> = {}): MeasuresSpine {
  return {
    weekEnding: THIS_FRIDAY,
    weeks: WEEKS,
    functions: [
      {
        id: "f1",
        title: "Sales and Business Dev",
        lead_id: "u_woody",
        track_id: null,
        sort_order: 0,
        parent_function_id: null,
      },
    ],
    roster: [{ id: "u_woody", full_name: "Woody" }],
    csfRows: [
      {
        id: "m1",
        description: "Total factored pipeline",
        detail: null,
        target: "2500",
        value_type: "number",
        target_direction: "higher_is_better",
        auto_track: true,
        update_frequency: "weekly",
        target_hint: null,
        function_id: "f1",
        sort_order: 0,
        created_at: "2026-03-01T00:00:00Z",
      },
    ],
    targetRows: [],
    entryRows: [],
    ...over,
  } as MeasuresSpine;
}

describe("weeks are grouped by the month their Friday falls in", () => {
  it("files a week that straddles a month by its end date", () => {
    // The week Sat 29 Aug to Fri 4 Sep is September's, because that
    // is where its Friday is. A monthly measure reports on a Friday,
    // so filing by the end date is what keeps a month's reporting
    // week inside that month.
    expect(monthKeyOf("2026-09-04")).toBe("2026-09");
  });

  it("names a month in a way a reader can scan", () => {
    expect(monthLabel("2026-09")).toBe("Sep 2026");
  });

  it("covers every week exactly once, in order", () => {
    const months = groupWeeksByMonth(WEEKS, THIS_FRIDAY);
    const flat = months.flatMap((m) => m.weeks);
    expect(flat).toEqual([...WEEKS]);
  });

  it("marks the month holding the current week", () => {
    const months = groupWeeksByMonth(WEEKS, THIS_FRIDAY);
    const current = months.filter((m) => m.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].key).toBe("2026-09");
    // And it is the last one, so the page opens at the right edge.
    expect(months.at(-1)?.key).toBe("2026-09");
  });
});

describe("a blank cell is not a miss", () => {
  it("expects a weekly measure every week", () => {
    const grid = buildGridData(spine(), "u_woody", true);
    expect(grid.groups[0].rows[0].cells.every((c) => c.expected)).toBe(true);
  });

  it("expects a monthly measure only in its month's last week", () => {
    const grid = buildGridData(
      spine({
        csfRows: [
          { ...spine().csfRows[0], update_frequency: "monthly" },
        ],
      }),
      "u_woody",
      true
    );
    const expected = grid.groups[0].rows[0].cells
      .filter((c) => c.expected)
      .map((c) => c.weekEnding);
    // Six months of window, one expected week per month.
    expect(expected).toEqual([
      "2026-04-24",
      "2026-05-29",
      "2026-06-26",
      "2026-07-31",
      "2026-08-28",
      "2026-09-25",
    ]);
  });

  it("does not call an unexpected week unlogged", () => {
    // The whole point. A monthly row is blank for three weeks in
    // four, and reading those as gaps would make every monthly
    // measure look permanently delinquent.
    const grid = buildGridData(
      spine({
        csfRows: [{ ...spine().csfRows[0], update_frequency: "monthly" }],
      }),
      "u_woody",
      true
    );
    const notExpected = grid.groups[0].rows[0].cells.filter((c) => !c.expected);
    expect(notExpected.length).toBeGreaterThan(0);
    expect(notExpected.every((c) => c.status !== "unlogged")).toBe(true);
  });

  it("expects nothing before the measure was created", () => {
    const grid = buildGridData(
      spine({
        csfRows: [
          { ...spine().csfRows[0], created_at: "2026-08-10T00:00:00Z" },
        ],
      }),
      "u_woody",
      true
    );
    const cells = grid.groups[0].rows[0].cells;
    expect(cells.find((c) => c.weekEnding === "2026-05-01")?.expected).toBe(true);
    // Weekly is always due, so the anchor only bounds the slower
    // frequencies. Pinned so a change to that reads as deliberate.
    expect(cells.every((c) => c.expected)).toBe(true);
  });
});

describe("every week is judged by the target that applied to it", () => {
  const history = [
    {
      measure_id: "m1",
      target: "60",
      value_type: "number" as const,
      target_direction: "higher_is_better" as const,
      effective_from: "2026-04-24",
    },
    {
      measure_id: "m1",
      target: "55",
      value_type: "number" as const,
      target_direction: "higher_is_better" as const,
      effective_from: "2026-09-18",
    },
  ];
  const entries = [
    { measure_id: "m1", week_ending: "2026-09-11", value_number: 58, value_text: null },
    { measure_id: "m1", week_ending: "2026-09-18", value_number: 58, value_text: null },
  ];

  it("misses in August and hits in September on the same number", () => {
    // The worked example. 58 against 60 is a miss; 58 against 55 is a
    // hit. Without the history both read against 55 and the earlier
    // week silently turns green.
    const grid = buildGridData(
      spine({ targetRows: history, entryRows: entries }),
      "u_woody",
      true
    );
    const cells = grid.groups[0].rows[0].cells;
    const at = (w: string) => cells.find((c) => c.weekEnding === w);
    expect(at("2026-09-11")?.status).toBe("off");
    expect(at("2026-09-18")?.status).toBe("good");
  });

  it("carries the target each cell was judged against", () => {
    const grid = buildGridData(
      spine({ targetRows: history, entryRows: entries }),
      "u_woody",
      true
    );
    const cells = grid.groups[0].rows[0].cells;
    expect(cells.find((c) => c.weekEnding === "2026-09-11")?.target).toBe("60");
    expect(cells.find((c) => c.weekEnding === "2026-09-18")?.target).toBe("55");
  });

  it("marks the week the target moved", () => {
    const grid = buildGridData(
      spine({ targetRows: history, entryRows: entries }),
      "u_woody",
      true
    );
    expect(grid.groups[0].rows[0].targetChanges.get("2026-09-18")).toEqual({
      from: "60",
      to: "55",
    });
  });

  it("reads no_target for a week before any target existed", () => {
    const grid = buildGridData(
      spine({
        targetRows: [history[1]],
        entryRows: [
          { measure_id: "m1", week_ending: "2026-05-01", value_number: 58, value_text: null },
        ],
      }),
      "u_woody",
      true
    );
    expect(
      grid.groups[0].rows[0].cells.find((c) => c.weekEnding === "2026-05-01")
        ?.status
    ).toBe("no_target");
  });
});

describe("the owner column is the function's Lead", () => {
  it("names the seat holder", () => {
    const grid = buildGridData(spine(), "u_woody", true);
    expect(grid.groups[0].ownerName).toBe("Woody");
  });

  it("is blank rather than wrong when the seat is empty", () => {
    const grid = buildGridData(
      spine({
        functions: [{ ...spine().functions[0], lead_id: null }],
      }),
      "u_woody",
      true
    );
    expect(grid.groups[0].ownerName).toBeNull();
  });
});

describe("who gets an input", () => {
  it("lets the Lead write their own function", () => {
    const grid = buildGridData(spine(), "u_woody", false);
    expect(grid.groups[0].canLog).toBe(true);
  });

  it("does not let somebody else write it", () => {
    const grid = buildGridData(spine(), "u_someone", false);
    expect(grid.groups[0].canLog).toBe(false);
  });

  it("lets an admin write every function", () => {
    const grid = buildGridData(spine(), "u_someone", true);
    expect(grid.groups[0].canLog).toBe(true);
  });
});

describe("cellStatus", () => {
  it("is unlogged with no value, whatever the target", () => {
    expect(cellStatus(null, "60", "number", "higher_is_better")).toBe("unlogged");
    expect(
      cellStatus({ number: null, text: null }, "60", "number", "higher_is_better")
    ).toBe("unlogged");
  });

  it("is no_target with a value and no target", () => {
    // Most rows on the fleet. It must not read as off target.
    expect(
      cellStatus({ number: 5, text: null }, null, "number", "higher_is_better")
    ).toBe("no_target");
  });

  it("respects the direction", () => {
    expect(
      cellStatus({ number: 4, text: null }, "5", "number", "lower_is_better")
    ).toBe("good");
    expect(
      cellStatus({ number: 6, text: null }, "5", "number", "lower_is_better")
    ).toBe("off");
  });

  it("treats the target as met at exactly the target", () => {
    expect(
      cellStatus({ number: 5, text: null }, "5", "number", "higher_is_better")
    ).toBe("good");
  });

  it("compares text case- and space-insensitively", () => {
    expect(
      cellStatus({ number: null, text: " yes " }, "Yes", "text", "higher_is_better")
    ).toBe("good");
  });

  it("strips currency and separators from a target", () => {
    expect(
      cellStatus({ number: 1200, text: null }, "$1,200", "number", "higher_is_better")
    ).toBe("good");
  });

  it("is no_target when the target is words rather than a number", () => {
    expect(
      cellStatus({ number: 5, text: null }, "soon", "number", "higher_is_better")
    ).toBe("no_target");
  });
});
