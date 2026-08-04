import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addDays, thisFriday } from "@/lib/dates";
import type { MetricValueType, TargetDirection } from "@/lib/types";

// Generative operational-performance signals for the dashboard.
// Four appreciative-inquiry lenses:
//   * Gaining ground — measures with an upward trend across the
//     last 6 weeks (direction-aware).
//   * Streaks in flight — measures at or above target for 3+
//     consecutive weeks.
//   * Wins this week — measures that hit target this week.
//   * Worth a conversation — measures with a sustained dip
//     (3+ consecutive weeks moving the wrong way). Never red; this
//     opens a coaching prompt, not a punishment.
//
// One measure can appear in more than one card (e.g., a streak that
// also hit target this week). That's fine — the story is different.
//
// Excludes archived and auto_track=false measures. Numeric only
// (text-value measures like "Yes / No" don't have a trend).

export type MeasureCardItem = {
  measureId: string;
  description: string;
  functionTitle: string;
  target: string | null;
  targetDirection: TargetDirection;
  currentValue: number | null;
  previousValue: number | null;
  streakWeeks: number; // for streaks card
  storyLine: string; // short narrative for the card
};

export type MeasureInsights = {
  gainingGround: MeasureCardItem[];
  streaks: MeasureCardItem[];
  winsThisWeek: MeasureCardItem[];
  worthAConversation: MeasureCardItem[];
};

const EMPTY: MeasureInsights = {
  gainingGround: [],
  streaks: [],
  winsThisWeek: [],
  worthAConversation: [],
};

const HISTORY_WEEKS = 6;
const CARD_LIMIT = 4;

export async function getMeasureInsights(
  companyId: string,
  timezone: string
): Promise<MeasureInsights> {
  const supabase = await createSupabaseServerClient();
  const weekEnding = thisFriday(timezone);
  const oldest = addDays(weekEnding, -7 * (HISTORY_WEEKS - 1));

  // Every company-scoped measure via the outcome → function join.
  const { data: fnRows } = await supabase
    .from("functions")
    .select("id, title")
    .eq("company_id", companyId)
    .eq("archived", false);
  const functions = (fnRows ?? []) as Array<{ id: string; title: string }>;
  if (functions.length === 0) return EMPTY;
  const functionTitleById = new Map(functions.map((f) => [f.id, f.title]));

  const { data: outcomeRows } = await supabase
    .from("function_outcomes")
    .select("id, function_id")
    .in(
      "function_id",
      functions.map((f) => f.id)
    );
  const outcomes = (outcomeRows ?? []) as Array<{
    id: string;
    function_id: string;
  }>;
  if (outcomes.length === 0) return EMPTY;
  const functionByOutcome = new Map(
    outcomes.map((o) => [o.id, o.function_id])
  );

  const { data: measureRows } = await supabase
    .from("success_measures")
    .select(
      "id, description, target, value_type, target_direction, auto_track, outcome_id, archived"
    )
    .in(
      "outcome_id",
      outcomes.map((o) => o.id)
    )
    .eq("archived", false)
    .eq("auto_track", true);
  type Measure = {
    id: string;
    description: string;
    target: string | null;
    value_type: MetricValueType;
    target_direction: TargetDirection;
    outcome_id: string;
  };
  const measures = (measureRows ?? []) as Measure[];
  if (measures.length === 0) return EMPTY;

  const { data: entryRows } = await supabase
    .from("success_measure_entries")
    .select("measure_id, week_ending, value_number")
    .in(
      "measure_id",
      measures.map((m) => m.id)
    )
    .gte("week_ending", oldest)
    .lte("week_ending", weekEnding)
    .order("week_ending", { ascending: false });
  type EntryRow = {
    measure_id: string;
    week_ending: string;
    value_number: number | null;
  };
  const entriesByMeasure = new Map<string, EntryRow[]>();
  for (const row of (entryRows ?? []) as EntryRow[]) {
    const list = entriesByMeasure.get(row.measure_id) ?? [];
    list.push(row);
    entriesByMeasure.set(row.measure_id, list);
  }

  const gainingGround: MeasureCardItem[] = [];
  const streaks: MeasureCardItem[] = [];
  const winsThisWeek: MeasureCardItem[] = [];
  const worthAConversation: MeasureCardItem[] = [];

  for (const m of measures) {
    // Numeric only for trend/streak semantics.
    if (m.value_type === "text") continue;

    const entries = entriesByMeasure.get(m.id) ?? [];
    // entries are DESC by week; convert to ASC for trend math.
    const asc = [...entries].reverse();
    const numeric = asc
      .filter((e) => e.value_number != null)
      .map((e) => ({ week: e.week_ending, value: e.value_number as number }));

    if (numeric.length === 0) continue;

    const latest = numeric[numeric.length - 1];
    const previous = numeric.length > 1 ? numeric[numeric.length - 2] : null;
    const targetValue = parseTargetNumber(m.target);
    const better = (a: number, b: number) =>
      m.target_direction === "higher_is_better" ? a > b : a < b;
    const meetsTarget = (v: number) =>
      targetValue == null
        ? false
        : m.target_direction === "higher_is_better"
          ? v >= targetValue
          : v <= targetValue;

    const functionTitle =
      functionTitleById.get(functionByOutcome.get(m.outcome_id) ?? "") ?? "—";

    const base = {
      measureId: m.id,
      description: m.description,
      functionTitle,
      target: m.target,
      targetDirection: m.target_direction,
      currentValue: latest.value,
      previousValue: previous?.value ?? null,
      streakWeeks: 0,
      storyLine: "",
    } satisfies Omit<MeasureCardItem, "storyLine"> & { storyLine: string };

    // Wins this week — hit target with a value logged for the
    // current week ending.
    if (latest.week === weekEnding && meetsTarget(latest.value)) {
      winsThisWeek.push({
        ...base,
        storyLine: `Hit target of ${m.target} this week — ${latest.value}.`,
      });
    }

    // Streaks — trailing consecutive weeks at or above target.
    let streak = 0;
    for (let i = numeric.length - 1; i >= 0; i -= 1) {
      if (meetsTarget(numeric[i].value)) streak += 1;
      else break;
    }
    if (streak >= 3) {
      streaks.push({
        ...base,
        streakWeeks: streak,
        storyLine: `${streak} weeks running at or ${m.target_direction === "higher_is_better" ? "above" : "below"} target.`,
      });
    }

    // Gaining ground — linear trend across all points is in the
    // "better" direction. Requires ≥3 data points so a one-off jump
    // doesn't earn a spot.
    if (numeric.length >= 3) {
      const first = numeric[0].value;
      const last = numeric[numeric.length - 1].value;
      if (better(last, first)) {
        const delta = Math.abs(last - first);
        gainingGround.push({
          ...base,
          storyLine: `Moved from ${first} to ${last} over ${numeric.length} weeks (${m.target_direction === "higher_is_better" ? "+" : "-"}${round(delta)}).`,
        });
      }
    }

    // Worth a conversation — three or more consecutive weeks moving
    // the wrong way at the tail (trend is bad and hasn't turned).
    if (numeric.length >= 3) {
      const tail = numeric.slice(-3);
      const allWorse =
        !better(tail[1].value, tail[0].value) &&
        !better(tail[2].value, tail[1].value);
      if (allWorse && tail[0].value !== tail[2].value) {
        worthAConversation.push({
          ...base,
          storyLine: `Slipped over the last 3 weeks — worth exploring what changed.`,
        });
      }
    }
  }

  return {
    gainingGround: gainingGround.slice(0, CARD_LIMIT),
    streaks: streaks
      .sort((a, b) => b.streakWeeks - a.streakWeeks)
      .slice(0, CARD_LIMIT),
    winsThisWeek: winsThisWeek.slice(0, CARD_LIMIT),
    worthAConversation: worthAConversation.slice(0, CARD_LIMIT),
  };
}

function parseTargetNumber(target: string | null): number | null {
  if (!target) return null;
  const cleaned = target.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
