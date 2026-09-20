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
        value_scale: "plain",
        target_direction: "higher_is_better",
        auto_track: true,
        update_frequency: "weekly",
        target_hint: null,
        function_id: "f1",
        sort_order: 0,
        created_at: "2026-03-01T00:00:00Z",
        show_on_dashboard: true,
      },
    ],
    targetRows: [],
    entryRows: [],
    ...over,
  } as MeasuresSpine;
}

describe("weeks are grouped by the month they BEGIN in", () => {
  it("files a week that straddles a month by its start date", () => {
    // Reversed on 2026-09-19, with the page's labelling.
    //
    // The week ending Fri 4 Sep begins Mon 31 Aug, so it is August's.
    // It used to be September's, which was the same answer to a
    // different question while a column was labelled with its Friday.
    // Now that a column shows its Monday, filing this one under
    // September would put "31" under a September heading.
    expect(monthKeyOf("2026-09-04")).toBe("2026-08");

    // And a week wholly inside a month is unaffected, which is most
    // of them: Mon 14 Sep to Fri 18 Sep is September either way.
    expect(monthKeyOf("2026-09-18")).toBe("2026-09");
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
    // Six months of window, one expected week per month — still one
    // each, but a different one since 2026-09-19.
    //
    // "The month's last week" now means the last week that BEGINS in
    // the month, because that is how the columns are grouped and
    // labelled. So March's is the week beginning Mon 30 Mar, which
    // ends Fri 3 Apr; April's begins Mon 27 Apr and ends Fri 1 May.
    // These are still the Fridays the values are stored against.
    expect(expected).toEqual([
      "2026-04-03", // begins Mon 30 Mar
      "2026-05-01", // begins Mon 27 Apr
      "2026-05-29", // begins Mon 25 May
      "2026-07-03", // begins Mon 29 Jun
      "2026-07-31", // begins Mon 27 Jul
      "2026-09-04", // begins Mon 31 Aug
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

// ---- How a value READS, which is decided by its value_type -------
//
// Nothing pinned this, and it is the whole reason a measure carries a
// value_type at all. Worth pinning now because it is also the answer
// to "can a percentage show as 13%": it already could, and the
// measures that were not doing it were simply typed Number. Two in
// production were retyped on 2026-09-20 rather than any code changing.
//
// The STORED value is identical either way — both number and percent
// live in value_number — so retyping a measure moves nothing and only
// changes how the same figure reads.
describe("displayValue formats by value_type", () => {
  function gridWith(valueType: string, value: number) {
    return buildGridData(
      spine({
        csfRows: [{ ...spine().csfRows[0], value_type: valueType }],
        entryRows: [
          {
            measure_id: "m1",
            week_ending: THIS_FRIDAY,
            value_number: value,
            value_text: null,
          },
        ],
      } as never),
      "u_woody",
      true
    );
  }

  function cellFor(valueType: string, value: number): string {
    const grid = gridWith(valueType, value);
    const cell = grid.groups[0].rows[0].cells.find(
      (c) => c.weekEnding === THIS_FRIDAY
    );
    return cell?.displayValue ?? "(no cell)";
  }

  it("adds a percent sign to a percent measure", () => {
    expect(cellFor("percent", 12.59)).toBe("12.59%");
  });

  it("leaves a plain number alone", () => {
    // The same figure, typed Number, is what "Gross margin on
    // completed jobs (%)" was showing before it was retyped.
    expect(cellFor("number", 12.59)).toBe("12.59");
  });

  it("renders money as money, since 0219", () => {
    // This used to assert the opposite — that there was no currency
    // type and money read bare. 0219 added one, and the CHECK
    // constraint moved with it, which is what that test was there to
    // make somebody remember.
    expect(cellFor("currency", 1234)).toBe("$1,234");
  });
});
