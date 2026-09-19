import { fridayOf, mondayOf } from "@/lib/dates";
import { expectedFridaysIn } from "@/lib/measures/frequency";
import {
  groupTargetHistory,
  targetInForce,
  targetChangesWithin,
} from "@/lib/measures/target-history";
import {
  loadMeasuresSpine,
  orderFunctionsByHierarchy,
  type MeasuresSpine,
} from "@/lib/measures/spine";
import type {
  MetricValueType,
  TargetDirection,
  UpdateFrequency,
} from "@/lib/types";

// The /measures grid: the spreadsheet, in the app.
//
// Functional Area | Owner | Critical Success Factor | Frequency |
// Target | one column per week.
//
// ---- WHY THE WEEKS ARE GROUPED BY MONTH ----------------------
//
// A rolling year is 52 columns and nobody needs 52 at once. The
// current month is open and the rest are one column each, carrying
// their name, so the page opens on the week you are filling in and
// the history is a click away rather than a scroll away.
//
// A collapsed month shows its name and nothing else. Deliberately:
// any summary value it could show (the last week, an average) would
// be a number nobody entered, sitting in a row of numbers people did.
//
// ---- A BLANK CELL IS NOT A MISS ------------------------------
//
// A monthly measure reports once, in its month's last week. The other
// three or four weeks are not late, they are not expected, and the
// grid has to say so: `expected` is false on those cells and they
// render as nothing at all rather than as an unlogged gap.
//
// This is the same question `isDueForWeek` answers for the Saturday
// sweep, asked by the same function, so the page and the nudge cannot
// disagree about whether a week was owed.
//
// ---- EVERY WEEK IS JUDGED BY ITS OWN TARGET ------------------
//
// Not by the current one. That is what the history from 0215 is for,
// and this is the first surface to use it: lowering a target changes
// the cells from that week forward and leaves the rest alone. Where
// the target moved inside the window, the row says so.

export type GridCellStatus = "good" | "off" | "unlogged" | "no_target";

export type GridCell = {
  weekEnding: string;
  // False when this measure was not due this week. Renders empty, and
  // is never counted as missing.
  expected: boolean;
  status: GridCellStatus;
  value: { number: number | null; text: string | null } | null;
  displayValue: string;
  // The target this week was judged against, which is not necessarily
  // the one on the row today.
  target: string | null;
};

// Short enough to sit in a pinned column. FREQUENCY_LABELS reads
// "Every two weeks", which is the right phrasing for a form label and
// too wide for a column that has to stay on screen beside Target.
const SHORT_FREQUENCY: Record<UpdateFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Fortnightly",
  monthly: "Monthly",
};

export type GridRow = {
  id: string;
  description: string;
  detail: string | null;
  frequency: UpdateFrequency;
  frequencyLabel: string;
  // The CURRENT target, for the Target column. Cells carry their own.
  target: string | null;
  valueType: MetricValueType;
  direction: TargetDirection;
  autoTrack: boolean;
  showOnDashboard: boolean;
  targetHint: string | null;
  cells: GridCell[];
  // Keyed by the week the change takes effect on.
  targetChanges: Map<string, { from: string | null; to: string | null }>;
};

export type GridGroup = {
  functionId: string;
  functionTitle: string;
  // The function's parent, carried so the page knows which groups are
  // SIBLINGS. Reordering functional areas moves a function among its
  // siblings and nowhere else: the order this page renders in is the
  // chart's hierarchy, so a drag that crossed parents would be a
  // chart edit wearing a grid's clothes, and the next render would
  // put the row back where it started.
  //
  // In practice this reads as a flat reorder, because that is the
  // shape of the data: every company on the fleet nests nearly every
  // function under one parent, so the areas people actually reorder
  // are already siblings of each other.
  parentFunctionId: string | null;
  // The function's Lead. Decided: owner is the seat, not a column on
  // the measure, which is how the spreadsheet's merged Owner cells
  // already work.
  ownerName: string | null;
  canLog: boolean;
  rows: GridRow[];
};

export type GridMonth = {
  key: string; // "2026-09"
  label: string; // "Sep 2026"
  weeks: string[];
  // Whether it holds the week the page opens on.
  isCurrent: boolean;
};

export type GridData = {
  weeks: string[];
  months: GridMonth[];
  currentWeekEnding: string;
  // The week that just closed, and the other one still open for
  // entry. A WEEK STAYS OPEN UNTIL THE END OF THE FOLLOWING ONE,
  // which is exactly the window the Saturday nudge gives: it asks for
  // this week on the Saturday it closes and makes it due the coming
  // Friday. Before, the page offered only the current column, so
  // acting on that nudge recorded the number against the wrong week.
  previousWeekEnding: string | null;
  groups: GridGroup[];
  hasRows: boolean;
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// A week belongs to the month its FRIDAY falls in.
//
// Weeks run Saturday to Friday, so one straddles a month boundary
// four or five times a year. Filing it by the end date means a
// monthly measure's reporting week and its month agree, which is the
// whole reason the grouping exists.
// WHICH MONTH A WEEK BELONGS TO — the month it BEGINS in.
//
// It used to be the month it ended in, which was the same question
// while the page said "week ending". Now that a column is labelled
// with its Monday, filing the week beginning Mon 28 Sep under October
// would put a September-looking number under an October heading.
//
// This is the one place the relabelling stops being cosmetic, and it
// moves `isLastFridayOfMonth` with it: a monthly measure is due in
// the month's last week, and "last week" has to mean the same thing
// here and there or the column and the due date disagree.
export function monthKeyOf(weekEnding: string): string {
  return mondayOf(weekEnding).slice(0, 7);
}

export function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

export function groupWeeksByMonth(
  weeks: readonly string[],
  currentWeekEnding: string
): GridMonth[] {
  const currentKey = monthKeyOf(currentWeekEnding);
  const order: string[] = [];
  const byKey = new Map<string, string[]>();
  for (const week of weeks) {
    const key = monthKeyOf(week);
    const list = byKey.get(key);
    if (list) list.push(week);
    else {
      byKey.set(key, [week]);
      order.push(key);
    }
  }
  return order.map((key) => ({
    key,
    label: monthLabel(key),
    weeks: byKey.get(key) ?? [],
    isCurrent: key === currentKey,
  }));
}

function formatValue(
  valueType: MetricValueType,
  value: { number: number | null; text: string | null } | null
): string {
  if (!value) return "";
  if (valueType === "text") return value.text ?? "";
  if (value.number == null || !Number.isFinite(value.number)) return "";
  return valueType === "percent" ? `${value.number}%` : String(value.number);
}

function parseTargetNumber(target: string): number | null {
  const cleaned = target.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Judged against the target that applied to THIS week.
export function cellStatus(
  value: { number: number | null; text: string | null } | null,
  target: string | null,
  valueType: MetricValueType,
  direction: TargetDirection
): GridCellStatus {
  const hasValue =
    value !== null &&
    (valueType === "text"
      ? (value.text ?? "").trim() !== ""
      : value.number != null && Number.isFinite(value.number));
  if (!hasValue) return "unlogged";
  if (!target || target.trim() === "") return "no_target";
  if (valueType === "text") {
    return (value!.text ?? "").trim().toLowerCase() ===
      target.trim().toLowerCase()
      ? "good"
      : "off";
  }
  const targetNumber = parseTargetNumber(target);
  if (targetNumber === null) return "no_target";
  const actual = value!.number as number;
  return direction === "higher_is_better"
    ? actual >= targetNumber
      ? "good"
      : "off"
    : actual <= targetNumber
      ? "good"
      : "off";
}

export function buildGridData(
  spine: MeasuresSpine,
  userId: string,
  includeAll: boolean
): GridData {
  const { weeks, weekEnding: currentWeekEnding } = spine;
  const months = groupWeeksByMonth(weeks, currentWeekEnding);

  const rosterById = new Map(spine.roster.map((p) => [p.id, p.full_name]));
  const entriesByMeasureWeek = new Map<
    string,
    { number: number | null; text: string | null }
  >();
  for (const row of spine.entryRows) {
    entriesByMeasureWeek.set(`${row.measure_id}|${row.week_ending}`, {
      number: row.value_number,
      text: row.value_text,
    });
  }
  const targetsByMeasure = groupTargetHistory(spine.targetRows);

  const rowsByFunction = new Map<string, GridRow[]>();
  for (const csf of spine.csfRows) {
    const history = targetsByMeasure.get(csf.id) ?? [];
    const frequency = csf.update_frequency ?? "weekly";
    // A measure cannot have been due before it existed. Without the
    // anchor, a row created in August shows five months of cells that
    // read as weeks nobody filled in.
    const expectedWeeks = expectedFridaysIn({
      frequency,
      fridays: weeks,
      anchorFriday: fridayOf(csf.created_at.slice(0, 10)),
    });
    const cells: GridCell[] = weeks.map((week) => {
      const expected = expectedWeeks.has(week);
      const value = entriesByMeasureWeek.get(`${csf.id}|${week}`) ?? null;
      const inForce = targetInForce(history, week);
      const target = inForce?.target ?? null;
      return {
        weekEnding: week,
        expected,
        status: expected
          ? cellStatus(
              value,
              target,
              inForce?.valueType ?? csf.value_type,
              inForce?.targetDirection ?? csf.target_direction
            )
          : "no_target",
        value,
        // The current value_type formats it. How a number is DRAWN is
        // a presentation choice; how a week was JUDGED is a fact
        // about that week, and only the second comes from history.
        displayValue: formatValue(csf.value_type, value),
        target,
      };
    });

    const row: GridRow = {
      id: csf.id,
      description: csf.description,
      detail: csf.detail,
      frequency,
      frequencyLabel: SHORT_FREQUENCY[frequency],
      target: csf.target,
      valueType: csf.value_type,
      direction: csf.target_direction,
      autoTrack: csf.auto_track,
      showOnDashboard: csf.show_on_dashboard ?? true,
      targetHint: csf.target_hint,
      cells,
      targetChanges: targetChangesWithin(history, weeks),
    };
    const list = rowsByFunction.get(csf.function_id) ?? [];
    list.push(row);
    rowsByFunction.set(csf.function_id, list);
  }

// THE TRACK SEAT IS NOT CONSULTED, and that is not an oversight.
//
// `functions.track_id` has no input anywhere in src/app or
// src/components. chart/actions.ts reads it from FormData that no
// form submits, so every function written through the application
// sets it null. Fleet-wide on production: 60 functions, 34 with a
// Lead, three with a track_id, two of which differ from the lead.
//
// Reading a column nothing populates is a branch that cannot be
// tested and cannot be trusted, so it comes out here. The columns
// stay: dropping them is a fleet migration for two rows and is
// tracked on its own.

  // Chart order, not sort_order: Visionary first, Integrator second,
  // every other function following its parent. The grid reads as the
  // org does, and `includeAll` decides only whose functions come
  // first so a leader lands on their own without scrolling.
  //
  // ONE ORDER, THE SAME FOR EVERYONE. This used to float a viewer's
  // own functions to the top when they were not an admin, so a Lead
  // landed on their own row without scrolling. That was a good idea
  // for a page nobody could arrange; it is the wrong one now the
  // order is something a person sets and expects to hold. Two people
  // comparing the same page have to be looking at the same page, and
  // a drag whose result only some viewers see is not a saved order.
  const orderedFunctions = orderFunctionsByHierarchy(spine.functions);

  const groups: GridGroup[] = orderedFunctions.map((fn) => ({
    functionId: fn.id,
    functionTitle: fn.title,
    parentFunctionId: fn.parent_function_id,
    ownerName: fn.lead_id ? rosterById.get(fn.lead_id) ?? null : null,
    // Same rule upsertMeasureEntryAction enforces, so the page never
    // draws an input the server would refuse.
    canLog: includeAll || fn.lead_id === userId,
    rows: rowsByFunction.get(fn.id) ?? [],
  }));

  return {
    weeks,
    months,
    currentWeekEnding,
    previousWeekEnding: weeks.length >= 2 ? weeks[weeks.length - 2] : null,
    // Functions with nothing on them still render, so an admin has
    // somewhere to add the first row.
    groups,
    hasRows: groups.some((g) => g.rows.length > 0),
  };
}

// Load the spine and shape the grid from it. What /measures calls.
export async function getGridData(
  companyId: string,
  userId: string,
  timezone: string,
  includeAll: boolean
): Promise<GridData> {
  const spine = await loadMeasuresSpine(companyId, timezone);
  return buildGridData(spine, userId, includeAll);
}
