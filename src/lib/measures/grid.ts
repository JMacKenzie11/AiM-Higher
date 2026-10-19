import { fridayOf, mondayOf } from "@/lib/dates";
// Used here AND re-exported, so every existing importer keeps
// working. They live in months.ts because the client grid renders
// with them and this file is server-only.
import { monthKeyOf, monthLabel } from "./months";
export { monthKeyOf, monthLabel };
import {
  formatMeasureValue,
  parseScale,
  type MeasureScale,
} from "./value-format";
import { expectedFridaysIn, storageWeekFor } from "@/lib/measures/frequency";
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
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
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
  // The latest change to this week's value after it was first added
  // (0291), for the cell's hover text: who, when, and what it was.
  // Absent when the value has only ever been entered once.
  lastChange?: CellChange;
};

export type CellChange = {
  // Who changed it, or null for a scheduled pull with nobody signed in.
  by: string | null;
  at: string;
  // The value before, drawn the way the cell draws values.
  was: string;
  // Where the value before came from: a connector's name when it had
  // been pulled, so typing over a pulled value reads as that.
  wasPulledFrom: string | null;
  // Where the new value came from (null: typed by a person).
  nowPulledFrom: string | null;
};

// One row of success_measure_entry_changes, as the grid reads it.
export type EntryChangeRow = {
  measure_id: string;
  week_ending: string;
  action: "added" | "changed" | "removed";
  old_number: number | null;
  old_text: string | null;
  old_origin: string | null;
  new_origin: string | null;
  changed_by: string | null;
  changed_at: string;
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
  // The unit this is written in. Storage is always the true number.
  scale: MeasureScale;
  direction: TargetDirection;
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

// Formatting lives in value-format.ts, which the entry boxes use
// too. Two copies of "how a number reads" is how a cell and the box
// you type it into come to disagree.

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
  includeAll: boolean,
  // Newest first. Only changes after a value was first added matter.
  changeRows: EntryChangeRow[] = []
): GridData {
  const { weeks, weekEnding: currentWeekEnding } = spine;
  const months = groupWeeksByMonth(weeks, currentWeekEnding);
  // Columns are `weeks`; cells run one further where a monthly
  // measure's own week has not been drawn yet.
  const monthOwnWeek = storageWeekFor("monthly", currentWeekEnding);
  const cellWeeks =
    weeks.length > 0 && monthOwnWeek > weeks[weeks.length - 1]
      ? [...weeks, monthOwnWeek]
      : weeks;

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
  const latestChange = new Map<string, EntryChangeRow>();
  for (const c of changeRows) {
    if (c.action === "added") continue;
    const key = `${c.measure_id}|${c.week_ending}`;
    if (!latestChange.has(key)) latestChange.set(key, c);
  }

  const rowsByFunction = new Map<string, GridRow[]>();
  for (const csf of spine.csfRows) {
    const history = targetsByMeasure.get(csf.id) ?? [];
    const frequency = csf.update_frequency ?? "weekly";
    // A measure cannot have been due before it existed. Without the
    // anchor, a row created in August shows five months of cells that
    // read as weeks nobody filled in.
    const expectedWeeks = expectedFridaysIn({
      frequency,
      fridays: cellWeeks,
      anchorFriday: fridayOf(csf.created_at.slice(0, 10)),
    });
    // CELLS FOR ONE WEEK MORE THAN THERE ARE COLUMNS.
    //
    // A monthly value lands on the last week beginning in its month,
    // which usually ends in the next one: September's is the week
    // ending 2 October. The grid draws columns up to this week, so
    // that cell would not exist and the month's own number could not
    // be read back.
    //
    // It gets a cell and no column. The monthly row spans its month
    // rather than occupying a week, so it never needed a column —
    // only somewhere to keep the value it already has.
    const cells: GridCell[] = cellWeeks.map((week) => {
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
        displayValue: formatMeasureValue(
          csf.value_type,
          parseScale(csf.value_scale),
          value
        ),
        target,
        ...(() => {
          const c = latestChange.get(`${csf.id}|${week}`);
          if (!c) return {};
          const lastChange: CellChange = {
            by: c.changed_by ? rosterById.get(c.changed_by) ?? "Someone outside the company" : null,
            at: c.changed_at,
            was:
              formatMeasureValue(csf.value_type, parseScale(csf.value_scale), {
                number: c.old_number,
                text: c.old_text,
              }) || "empty",
            wasPulledFrom: c.old_origin,
            nowPulledFrom: c.new_origin,
          };
          return { lastChange };
        })(),
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
      scale: parseScale(csf.value_scale),
      direction: csf.target_direction,
      showOnDashboard: csf.show_on_dashboard ?? true,
      targetHint: csf.target_hint,
      cells,
      targetChanges: targetChangesWithin(history, weeks),
    };
    const list = rowsByFunction.get(csf.function_id) ?? [];
    list.push(row);
    rowsByFunction.set(csf.function_id, list);
  }

// THE LEAD IS THE ONLY SEAT (Jason, 2026-10-14). Every functional
// Lead holds Lead, Track and Decide; there is no separate Tracker or
// Decider. 0274 took track_id out of the entry policy, so who may
// enter values is who may author the measure: an admin here, or the
// function's Lead. 0277 dropped the track_id and decide_id columns.

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
    // Same rule the entry policy on success_measure_entries enforces, so the page never
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
  // Who changed which week, for the cells' hover text (0291). Only the
  // weeks on the page, and only changes, never the first entry.
  const measureIds = spine.csfRows.map((c) => c.id);
  let changeRows: EntryChangeRow[] = [];
  if (measureIds.length > 0 && spine.weeks.length > 0) {
    const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
    const { data } = await supabase
      .from("success_measure_entry_changes")
      .select("measure_id, week_ending, action, old_number, old_text, old_origin, new_origin, changed_by, changed_at")
      .in("measure_id", measureIds)
      .in("action", ["changed", "removed"])
      .gte("week_ending", spine.weeks[0])
      .order("changed_at", { ascending: false });
    changeRows = (data ?? []) as EntryChangeRow[];
  }
  return buildGridData(spine, userId, includeAll, changeRows);
}
