import { addDays, weekEndingOfInstant } from "@/lib/dates";
import type { HubSpotMapping, HubSpotSnapshotRecipe, HubSpotWeeklyRecipe } from "./mapping";
import type { PullDecision, PullDetail } from "./pull";

// THE HUBSPOT PULL (external connections plan, phase 4).
//
// HubSpot has no "add these up" call. Every recipe names which deals,
// the reader fetches them a page at a time, and this adds them up. The
// rules, each because the alternative is a confident wrong number:
//
//   A STAGE OR PIPELINE THAT IS GONE FAILS THE PULL. Deals are searched
//   by id; a deleted stage matches no deals, and a sum of no deals is a
//   plausible zero. So the pipeline is read first and every stage the
//   recipe names must still be in it.
//
//   THE WEEK IS THE COMPANY'S. HubSpot dates are instants. The search
//   window runs from the company's own Saturday midnight to the next,
//   and each deal is placed again with weekEndingOfInstant, so a deal
//   the search window and the platform disagree about is left out and
//   counted, never silently in the wrong week.
//
//   A DEAL WITH NO AMOUNT ADDS NOTHING, AND THE RECEIPT SAYS HOW MANY.
//   Its count is still right; its sum is short by whatever nobody typed.
//
//   AMOUNTS ARE IN THE ACCOUNT'S HOME CURRENCY, HubSpot's own
//   conversion, so a deal in another currency adds up the way it does in
//   HubSpot's reports.
//
//   MORE THAN HUBSPOT'S SEARCH WILL RETURN FAILS. Its search stops at
//   10,000 results for one query; a total built from the first 10,000
//   is a wrong number, not a partial one.

export type HubSpotStage = { id: string; label: string };
export type HubSpotPipeline = { id: string; label: string; stages: HubSpotStage[] };

export type DealFilter =
  | { propertyName: string; operator: "EQ"; value: string }
  | { propertyName: string; operator: "IN"; values: string[] }
  | { propertyName: string; operator: "GTE" | "LT"; value: string };

export type DealSearch = { filters: DealFilter[]; properties: string[] };

export type Deal = Record<string, string | null | undefined>;

export interface HubSpotReader {
  // Null when HubSpot has no such pipeline.
  pipeline(pipelineId: string): Promise<HubSpotPipeline | null>;
  // Every deal matching, across pages, with the total HubSpot reports.
  searchDeals(search: DealSearch): Promise<{ deals: Deal[]; total: number }>;
}

// Thrown by a reader when the company has no HubSpot key in the vault.
export class HubSpotNotConnected extends Error {
  constructor() {
    super("This company has no HubSpot key. Add one on Connections.");
  }
}

export const SEARCH_LIMIT = 10_000;
const AMOUNT = "amount_in_home_currency";
const WEIGHTED = "hs_projected_amount_in_home_currency";

// ---- The week, as instants ------------------------------------------

// Minutes the zone is ahead of UTC at a moment.
function offsetMinutes(at: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at) / 60_000);
}

// The instant a calendar day begins in a timezone.
export function localMidnight(ymd: string, timezone: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let at = guess - offsetMinutes(guess, timezone) * 60_000;
  // Once more, for a day on which the offset changes.
  at = guess - offsetMinutes(at, timezone) * 60_000;
  return at;
}

// The week ending on this Friday, Saturday midnight to Saturday midnight
// in the company's timezone, as [start, end) in epoch milliseconds.
export function weekWindow(weekEnding: string, timezone: string): [number, number] {
  return [localMidnight(addDays(weekEnding, -6), timezone), localMidnight(addDays(weekEnding, 1), timezone)];
}

function money(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- The pull ------------------------------------------------------------

function failed(reason: "hubspot_unreachable" | "hubspot_not_connected" | "hubspot_too_many" | "hubspot_stage_missing", detail: PullDetail): PullDecision {
  return { outcome: "failed", reason, detail };
}

function stagesIn(recipe: HubSpotWeeklyRecipe | HubSpotSnapshotRecipe): string[] {
  if ("parts" in recipe) return [...new Set(recipe.parts.flatMap((p) => p.stage_ids))];
  return recipe.date === "entered_stage" && recipe.stage_id ? [recipe.stage_id] : [];
}

async function weekly(
  reader: HubSpotReader,
  recipe: HubSpotWeeklyRecipe,
  weekEnding: string,
  timezone: string,
  base: PullDetail
): Promise<PullDecision> {
  const dateProperty = recipe.date === "created" ? "createdate" : `hs_v2_date_entered_${recipe.stage_id}`;
  const [start, end] = weekWindow(weekEnding, timezone);
  const { deals, total } = await reader.searchDeals({
    filters: [
      { propertyName: "pipeline", operator: "EQ", value: recipe.pipeline_id },
      { propertyName: dateProperty, operator: "GTE", value: String(start) },
      { propertyName: dateProperty, operator: "LT", value: String(end) },
    ],
    properties: [AMOUNT, dateProperty],
  });
  if (total > SEARCH_LIMIT) return failed("hubspot_too_many", { ...base, total });

  let counted = 0;
  let sum = 0;
  let withoutAmount = 0;
  let otherWeek = 0;
  for (const deal of deals) {
    const when = deal[dateProperty];
    const instant = when && /^\d+$/.test(when) ? new Date(Number(when)) : when ? new Date(when) : null;
    if (!instant || Number.isNaN(instant.getTime()) || weekEndingOfInstant(instant, timezone) !== weekEnding) {
      otherWeek += 1;
      continue;
    }
    counted += 1;
    const amount = money(deal[AMOUNT]);
    if (amount === null) withoutAmount += 1;
    else sum += amount;
  }
  const value = recipe.measure === "count" ? counted : round2(sum);
  return {
    outcome: "written",
    value,
    detail: {
      ...base,
      date_property: dateProperty,
      window_start: new Date(start).toISOString(),
      window_end: new Date(end).toISOString(),
      deals_counted: counted,
      deals_without_amount: withoutAmount,
      deals_outside_week: otherWeek,
    },
  };
}

async function snapshot(reader: HubSpotReader, recipe: HubSpotSnapshotRecipe, base: PullDetail): Promise<PullDecision> {
  let total = 0;
  const parts: Array<{ stage_ids: string[]; value: string; deals: number; deals_without_amount: number; sum: number }> = [];
  for (const part of recipe.parts) {
    const property = part.value === "weighted_amount" ? WEIGHTED : AMOUNT;
    const found = await reader.searchDeals({
      filters: [
        { propertyName: "pipeline", operator: "EQ", value: recipe.pipeline_id },
        { propertyName: "dealstage", operator: "IN", values: part.stage_ids },
      ],
      properties: [property],
    });
    if (found.total > SEARCH_LIMIT) return failed("hubspot_too_many", { ...base, total: found.total });
    let sum = 0;
    let withoutAmount = 0;
    for (const deal of found.deals) {
      const amount = money(deal[property]);
      if (amount === null) withoutAmount += 1;
      else sum += amount;
    }
    parts.push({ stage_ids: part.stage_ids, value: part.value, deals: found.deals.length, deals_without_amount: withoutAmount, sum: round2(sum) });
    total += sum;
  }
  return { outcome: "written", value: round2(total), detail: { ...base, parts } };
}

export async function runHubSpotPull(
  reader: HubSpotReader,
  mapping: HubSpotMapping,
  weekEnding: string,
  timezone: string
): Promise<PullDecision> {
  const base: PullDetail = {
    connector: "hubspot",
    kind: mapping.kind,
    pipeline_id: mapping.recipe.pipeline_id,
    week_ending: weekEnding,
  };
  try {
    const pipeline = await reader.pipeline(mapping.recipe.pipeline_id);
    if (!pipeline) return failed("hubspot_stage_missing", { ...base, missing: "pipeline" });
    const known = new Set(pipeline.stages.map((s) => s.id));
    const missing = stagesIn(mapping.recipe).filter((id) => !known.has(id));
    if (missing.length > 0) {
      return failed("hubspot_stage_missing", { ...base, missing: "stages", stage_ids: missing });
    }
    return mapping.kind === "weekly"
      ? await weekly(reader, mapping.recipe, weekEnding, timezone, base)
      : await snapshot(reader, mapping.recipe, base);
  } catch (err) {
    if (err instanceof HubSpotNotConnected) return failed("hubspot_not_connected", base);
    return failed("hubspot_unreachable", { ...base, error: err instanceof Error ? err.message : String(err) });
  }
}
