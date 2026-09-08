import "server-only";

import { loadMeasuresSpine, type MeasuresSpine } from "@/lib/measures/spine";
import type { MetricValueType, TargetDirection } from "@/lib/types";

// Read model for the operational Success Tracking board — 13
// weeks of metric performance across every function in the company.
// The board wants everything, sorted for status-first reading, and
// doesn't care about ownership.
//
// Shaping only. The rows come from loadMeasuresSpine, shared with the
// Manager tree, because four of the five reads were identical and the
// page renders both on the same paint.

export type BoardStatus = "good" | "off" | "unlogged" | "no_target";

export type BoardCell = {
  weekEnding: string;
  status: BoardStatus;
  // Pre-formatted value for the hover tooltip — the component
  // shouldn't need to re-derive from raw number/text.
  displayValue: string;
  // Numeric value for plotting. For number/percent this is the
  // raw number; for text/yes-no metrics we normalise to 1 (matches
  // target) or 0 (doesn't). Null when unlogged / no target.
  numericValue: number | null;
};

export type BoardMetric = {
  id: string;
  description: string;
  target: string | null;
  // Numeric form of the target for plotting the reference line.
  // Text metrics get a target of 1 to match the numericValue scale.
  targetNumeric: number | null;
  valueType: MetricValueType;
  direction: TargetDirection;
  outcomeTitle: string;
  // Which half of the model this row is. A critical success factor is
  // the result the function is accountable for; a KPI is a lead
  // measure someone moves weekly to get there. The timeline shows
  // both, so a row has to say which it is.
  kind: "csf" | "kpi";
  cells: BoardCell[];
};

export type BoardFunction = {
  id: string;
  title: string;
  seatHolder: string | null;
  parentId: string | null;
  // 0 for a root function (typically Visionary), 1 for its
  // children (typically Integrator), 2+ for everything downstream.
  // Used to keep the leadership seats pinned at the top of the
  // cockpit view regardless of current-week performance.
  depth: number;
  metrics: BoardMetric[];
};

export type BoardData = {
  weeks: string[];
  currentWeekEnding: string;
  functions: BoardFunction[];
};

// The Board, shaped from rows already in hand. Pure: see
// loadMeasuresSpine for the reads and getMeasuresPageData for the
// path the page takes.
export function buildBoardData(spine: MeasuresSpine): BoardData {
  const { weeks, weekEnding: currentWeekEnding } = spine;

  const functions = spine.functions;
  if (functions.length === 0) {
    return { weeks, currentWeekEnding, functions: [] };
  }
  const rosterById = new Map(spine.roster.map((r) => [r.id, r.full_name]));

  // CSF measures supply the grouping label each metric row shows
  // (migration 0166). A CSF's `description` is what the outcome
  // called `title`.
  const csfRows = spine.csfRows;
  const outcomes = csfRows.map((c) => ({
    id: c.id,
    title: c.description,
    function_id: c.function_id,
  }));
  const outcomeById = new Map(outcomes.map((o) => [o.id, o]));
  const outcomeIds = outcomes.map((o) => o.id);

  // Which KPI drives which CSF, so each row can still show the group
  // it belongs to. Take the first link for the label: the UI allows
  // one CSF per KPI today, but the data model does not, and a row that
  // drives two should not crash the board.
  const linkRows = spine.linkRows;
  const csfIdByKpi = new Map<string, string>();
  for (const link of linkRows) {
    if (!csfIdByKpi.has(link.kpi_id)) csfIdByKpi.set(link.kpi_id, link.csf_id);
  }

  const measures: Array<{
    id: string;
    csfId: string;
    description: string;
    target: string | null;
    value_type: MetricValueType;
    target_direction: TargetDirection;
    sort_order: number;
    kind: "csf" | "kpi";
  }> = [];

  // Critical success factors are plotted rows in their own right,
  // not just group headings. They carry a target and a weekly value
  // like any KPI does (migration 0166 made them measurable), so a
  // board that only drew KPIs was hiding the very numbers the
  // function is held to. Each CSF groups under itself, which puts it
  // at the head of its own set of lead measures.
  measures.push(
    ...csfRows.map((c) => ({
      id: c.id,
      description: c.description,
      target: c.target,
      value_type: c.value_type,
      target_direction: c.target_direction,
      sort_order: c.sort_order,
      csfId: c.id,
      kind: "csf" as const,
    }))
  );

  if (outcomeIds.length > 0) {
    measures.push(
      ...spine.kpiRows.map((m) => ({
        id: m.id,
        description: m.description,
        target: m.target,
        value_type: m.value_type,
        target_direction: m.target_direction,
        sort_order: m.sort_order,
        csfId: csfIdByKpi.get(m.id) ?? "",
        kind: "kpi" as const,
      }))
    );
  }

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

  // Depth = number of hops to reach a root ancestor. Used by the
  // cockpit view so Visionary (root) and Integrator (Visionary's
  // child) always sit at the top of the grid regardless of how
  // this week's numbers landed.
  const parentById = new Map(
    functions.map((f) => [f.id, f.parent_function_id])
  );
  const depthCache = new Map<string, number>();
  const computeDepth = (id: string, seen = new Set<string>()): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const parent = parentById.get(id);
    const d = parent ? 1 + computeDepth(parent, seen) : 0;
    depthCache.set(id, d);
    return d;
  };

  const boardFunctions: BoardFunction[] = functions.map((fn) => {
    const fnOutcomeIds = outcomes
      .filter((o) => o.function_id === fn.id)
      .map((o) => o.id);
    // Group by CSF, and inside each group put the CSF row first so
    // the lag measure reads above the lead measures that drive it.
    const fnMeasures = fnOutcomeIds.flatMap((outcomeId) => {
      const inGroup = measures.filter((m) => m.csfId === outcomeId);
      const csf = inGroup.filter((m) => m.kind === "csf");
      const kpis = inGroup
        .filter((m) => m.kind === "kpi")
        .sort((a, b) => a.sort_order - b.sort_order);
      return [...csf, ...kpis];
    });
    return {
      id: fn.id,
      title: fn.title,
      seatHolder: fn.lead_id ? rosterById.get(fn.lead_id) ?? null : null,
      parentId: fn.parent_function_id,
      depth: computeDepth(fn.id),
      metrics: fnMeasures.map((m) => {
        const targetNumeric =
          m.value_type === "text"
            ? m.target
              ? 1
              : null
            : parseNum(m.target);
        return {
          id: m.id,
          description: m.description,
          target: m.target,
          targetNumeric,
          valueType: m.value_type,
          direction: m.target_direction,
          outcomeTitle: outcomeById.get(m.csfId)?.title ?? "—",
          kind: m.kind,
          cells: weeks.map((w) => {
            const entry = entriesByMeasureWeek.get(`${m.id}|${w}`) ?? null;
            const status = computeStatus(m, entry);
            return {
              weekEnding: w,
              status,
              displayValue: formatValue(m.value_type, entry),
              numericValue: extractNumericValue(m, entry),
            };
          }),
        };
      }),
    };
  });

  return { weeks, currentWeekEnding, functions: boardFunctions };
}

// Convenience wrapper: load the spine and shape the board from it.
//
// The page does NOT take this path — it uses getMeasuresPageData so
// the board and the tree share one spine. This exists for a caller
// that wants the board alone, and it is what the characterisation
// tests drive.
export async function getBoardData(
  companyId: string,
  timezone: string
): Promise<BoardData> {
  const spine = await loadMeasuresSpine(companyId, timezone);
  return buildBoardData(spine);
}

// Coerce an entry into a plottable number. For number/percent we
// return the raw value; for text (yes/no) we return 1 when the entry
// matches the target and 0 otherwise. Null when there's no entry —
// the sparkline breaks its line at null points so a missed week
// reads as a gap, not an interpolation.
function extractNumericValue(
  measure: {
    value_type: MetricValueType;
    target: string | null;
  },
  entry: { number: number | null; text: string | null } | null
): number | null {
  if (!entry) return null;
  if (measure.value_type === "text") {
    if (!entry.text) return null;
    const l = entry.text.trim().toLowerCase();
    const t = (measure.target ?? "").trim().toLowerCase();
    if (!t) return null;
    return l === t ? 1 : 0;
  }
  return entry.number != null && Number.isFinite(entry.number)
    ? entry.number
    : null;
}

// Compare an entry to its metric's target and return a bucketed
// status. Kept beside the fetch so the client component receives
// pre-shaped data and doesn't need to re-run the same comparison
// in JS on every render.
export function computeStatus(
  measure: {
    target: string | null;
    valueType?: MetricValueType;
    value_type?: MetricValueType;
    target_direction?: TargetDirection;
    direction?: TargetDirection;
  },
  entry: { number: number | null; text: string | null } | null
): BoardStatus {
  const valueType = measure.valueType ?? measure.value_type!;
  const direction = measure.direction ?? measure.target_direction!;
  if (!measure.target) return "no_target";
  if (!entry) return "unlogged";
  if (valueType === "text") {
    const l = (entry.text ?? "").trim().toLowerCase();
    const t = (measure.target ?? "").trim().toLowerCase();
    if (!l) return "unlogged";
    return l === t ? "good" : "off";
  }
  if (entry.number == null || !Number.isFinite(entry.number)) return "unlogged";
  const target = parseNum(measure.target);
  if (target == null) return "no_target";
  const hit =
    direction === "lower_is_better"
      ? entry.number <= target
      : entry.number >= target;
  return hit ? "good" : "off";
}

function parseNum(target: string | null): number | null {
  if (!target) return null;
  const cleaned = target.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatValue(
  valueType: MetricValueType,
  entry: { number: number | null; text: string | null } | null
): string {
  if (!entry) return "—";
  if (valueType === "text") return entry.text ?? "—";
  if (entry.number == null || !Number.isFinite(entry.number)) return "—";
  if (valueType === "percent") return `${entry.number}%`;
  return String(entry.number);
}
