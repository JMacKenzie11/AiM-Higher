import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildBoardData } from "./board";
import type { MeasuresSpine } from "./spine";

// Whether the board appears at all, and where.
//
// The rule, decided by the product owner: with Success Tracking on
// and nothing ever logged, show nothing. With one value logged, show
// it — sparse or not. A frame of thirteen empty weeks teaches nobody
// anything; one real point is sparse and true.

const WEEKS = ["2026-09-04", "2026-09-11", "2026-09-18"];

function spine(over: Partial<MeasuresSpine> = {}): MeasuresSpine {
  return {
    weekEnding: "2026-09-18",
    weeks: WEEKS,
    functions: [
      {
        id: "f1",
        title: "Integrator",
        lead_id: null,
        track_id: null,
        sort_order: 0,
        parent_function_id: null,
      },
    ],
    roster: [],
    csfRows: [
      {
        id: "csf1",
        description: "Raw processing lbs per labour hour",
        detail: null,
        target: "60",
        value_type: "number",
        target_direction: "higher_is_better",
        auto_track: true,
        update_frequency: "weekly",
        target_hint: null,
        function_id: "f1",
        sort_order: 0,
      },
    ],
    linkRows: [],
    kpiRows: [],
    entryRows: [],
    ...over,
  } as MeasuresSpine;
}

describe("hasEntries decides whether the board is worth showing", () => {
  it("is false when a company has measures but has never logged one", () => {
    // The case that has to render nothing. There are functions, there
    // is a critical success factor, there is a target — and thirteen
    // columns of blank.
    const board = buildBoardData(spine());
    expect(board.functions.length).toBeGreaterThan(0);
    expect(board.hasEntries).toBe(false);
  });

  it("is true on a single logged value", () => {
    const board = buildBoardData(
      spine({
        entryRows: [
          {
            measure_id: "csf1",
            week_ending: "2026-09-11",
            value_number: 58.26,
            value_text: null,
          },
        ],
      })
    );
    expect(board.hasEntries).toBe(true);
  });

  it("is false for a company with no functions at all", () => {
    // The early return. It is a separate code path and would have
    // been easy to leave the field off.
    const board = buildBoardData(spine({ functions: [], csfRows: [] }));
    expect(board.functions).toEqual([]);
    expect(board.hasEntries).toBe(false);
  });

  it("does NOT read the rendered cells, which cannot answer this", () => {
    // Why the field is carried rather than derived. A cell's status is
    // `no_target` before it is anything else, so a measure with a year
    // of values and no target draws identically to one nobody has ever
    // logged. Asking the rows is the only honest answer.
    const noTarget = buildBoardData(
      spine({
        csfRows: [
          {
            ...spine().csfRows[0],
            target: null,
          },
        ],
        entryRows: [
          {
            measure_id: "csf1",
            week_ending: "2026-09-11",
            value_number: 58.26,
            value_text: null,
          },
        ],
      })
    );
    const statuses = noTarget.functions
      .flatMap((f) => f.metrics)
      .flatMap((m) => m.cells)
      .map((c) => c.status);
    // Every cell says no_target, including the week that has a value.
    expect(new Set(statuses)).toEqual(new Set(["no_target"]));
    // And the board still knows there is something to show.
    expect(noTarget.hasEntries).toBe(true);
  });
});

// ---- Where it renders -------------------------------------------
//
// Source-level, because these are Server Components. What is pinned
// is the placement and the gate, both of which are a line each and
// both of which would be quietly wrong rather than broken.
describe("the board lives on the dashboard, under the brief", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const dashboard = readFileSync(
    path.join(ROOT, "src/app/(app)/dashboard/page.tsx"),
    "utf8"
  );
  const measures = readFileSync(
    path.join(ROOT, "src/app/(app)/measures/page.tsx"),
    "utf8"
  );

  it("renders on the dashboard", () => {
    expect(dashboard).toContain("<BoardView data={board} />");
  });

  it("sits directly under the brief card", () => {
    // "What's worth knowing today" is BriefSection. The brief says
    // what happened this week; the board says what the last thirteen
    // look like. Order is the whole point of where it was asked for.
    const brief = dashboard.indexOf("<BriefSection");
    const board = dashboard.indexOf("<BoardView");
    const insights = dashboard.indexOf("<MeasureInsightsCards");
    expect(brief).toBeGreaterThan(-1);
    expect(board).toBeGreaterThan(brief);
    expect(board).toBeLessThan(insights);
  });

  it("is gated on the flag AND on something having been logged", () => {
    expect(dashboard).toMatch(/board\s*&&\s*board\.hasEntries\s*\?/);
    expect(dashboard).toMatch(/perfTrackingOn\s*\n?\s*\?\s*await getBoardData/);
  });

  it("is gone from /measures", () => {
    // Moved, not duplicated. Two copies would drift and the page it
    // left is the one people open to type values, which is why it was
    // collapsed there in the first place.
    expect(measures).not.toContain("BoardView");
    expect(measures).not.toContain("board/BoardView");
  });
});

// ---- The measure's name is readable ----------------------------
//
// It was truncated with an ellipsis in the Grid view: "Raw Processing
// lbs per labo…". The name is the only thing on that row saying what
// is being plotted, and the part that got cut is usually the part
// that tells it apart from the next measure.
//
// A title attribute was carrying the rest, which is a hover tooltip:
// nothing on a phone, nothing to somebody scanning the card rather
// than pointing at it.
describe("the board does not truncate a measure's name", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const css = readFileSync(
    path.join(ROOT, "src/app/(app)/measures/board/board.module.css"),
    "utf8"
  );
  const grid = readFileSync(
    path.join(ROOT, "src/app/(app)/measures/board/CockpitGrid.tsx"),
    "utf8"
  );

  function rule(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} not found`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  }

  it("lets the name wrap", () => {
    const body = rule(".sparkName");
    expect(body).not.toContain("text-overflow");
    expect(body).not.toContain("white-space: nowrap");
    expect(body).toContain("overflow-wrap");
  });

  it("keeps the CSF chip on the line it labels", () => {
    // It sits inside the name, so a wrap can strand it above the
    // text it belongs to, where it reads as a heading.
    expect(rule(".sparkKindChip")).toContain("white-space: nowrap");
  });

  it("no longer hides the name behind a hover tooltip", () => {
    expect(grid).not.toMatch(/sparkName\}\s+title=/);
  });
});
