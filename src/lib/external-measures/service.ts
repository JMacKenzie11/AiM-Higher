import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { boardWeeks } from "@/lib/measures/spine";
import { parseMapping, type ExternalMapping } from "./mapping";
import { buildReceipt, type ReceiptView } from "./receipt";

// Reads shared by the actions and the page. Kept apart from actions.ts
// so a Server Component can import them without pulling "use server"
// into its module graph.

export type MeasureContext = {
  measureId: string;
  description: string;
  companyId: string;
  timezone: string;
  // null when the measure has no mapping, OR when it has one the
  // reader will not act on. The two are deliberately the same value
  // to every caller except the admin surface, which needs to tell a
  // system_admin that what is stored is unusable — see rawSource.
  mapping: ExternalMapping | null;
  rawSource: unknown;
};

type MeasureRow = {
  id: string;
  description: string;
  external_source: unknown;
  functions: { company_id: string } | null;
};

const FALLBACK_TZ = "America/Anchorage";

// Everything a pull needs about one measure, in two reads.
//
// The company comes through the function, which is how every measure
// reaches its tenant since 0168. Null when the measure does not
// exist, or when RLS says this caller may not see it — the caller
// cannot tell those apart and should not: both mean "not yours".
export async function loadMeasureContext(
  supabase: SupabaseClient,
  measureId: string
): Promise<MeasureContext | null> {
  const { data } = await supabase
    .from("success_measures")
    .select("id, description, external_source, functions!inner(company_id)")
    .eq("id", measureId)
    .maybeSingle<MeasureRow>();

  const companyId = data?.functions?.company_id;
  if (!data || !companyId) return null;

  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string | null }>();

  return {
    measureId: data.id,
    description: data.description,
    companyId,
    timezone: company?.timezone ?? FALLBACK_TZ,
    mapping: parseMapping(data.external_source),
    rawSource: data.external_source ?? null,
  };
}

export type PullLogRow = {
  id: string;
  measure_id: string;
  week_ending: string;
  mapping_kind: string;
  outcome: string;
  value_written: number | null;
  failure_reason: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

const LOG_COLS =
  "id, measure_id, week_ending, mapping_kind, outcome, value_written, failure_reason, detail, created_at";

// The most recent receipt for each of a set of measure/week pairs.
//
// One read for the whole page rather than one per entry: /measures
// renders every measure of every function, and a receipt lookup per
// row would be the N+1 the spine exists to avoid.
export async function loadReceipts(
  supabase: SupabaseClient,
  measureIds: readonly string[],
  fromWeek: string,
  toWeek: string
): Promise<PullLogRow[]> {
  if (measureIds.length === 0) return [];
  const { data } = await supabase
    .from("external_pull_log")
    .select(LOG_COLS)
    .in("measure_id", measureIds)
    .gte("week_ending", fromWeek)
    .lte("week_ending", toWeek)
    .order("created_at", { ascending: false });
  return (data ?? []) as PullLogRow[];
}

// The latest receipt per (measure, week). The log is append-only and
// a week can be pulled more than once, so "the receipt" means the
// most recent one — which is the row that explains the entry sitting
// there now.
export function latestByMeasureWeek(
  rows: readonly PullLogRow[]
): Map<string, PullLogRow> {
  const out = new Map<string, PullLogRow>();
  for (const r of rows) {
    const key = `${r.measure_id}:${r.week_ending}`;
    // rows arrive created_at descending, so the first one wins.
    if (!out.has(key)) out.set(key, r);
  }
  return out;
}

// ---- Everything /measures needs about external sources ---------
//
// ONE PASS, AND ONLY WHEN THE FLAG IS ON. Three small reads keyed on
// the measure ids the page already has, rather than a per-row lookup
// inside a component. Off, the page does not call this at all and
// external measures cost the other companies nothing — not a join,
// not a column, not a byte over the wire.

export type ExternalMeasureInfo = {
  // The measure's mapping, for the admin surface and for deciding
  // whether a pull button belongs on the row.
  mapping: ExternalMapping | null;
  // Set when the CURRENT week's entry came from a pull. Null when it
  // was typed, and null when there is no entry — which is the state
  // that must keep rendering as unlogged rather than as a zero.
  pulledAt: string | null;
  // The receipt for the current week's most recent pull, whatever it
  // did. Present even when nothing was written, because a refusal is
  // the thing worth reading.
  receipt: ReceiptView | null;
};

export type ExternalPanel = {
  timezone: string;
  // The thirteen week-endings the board already plots, oldest first.
  // The pull's week selector offers exactly these, which is what
  // keeps "which week is this" the platform's answer while still
  // letting a person say which one they mean.
  weeks: string[];
  byMeasureId: Record<string, ExternalMeasureInfo>;
};

export async function loadExternalPanel(
  supabase: SupabaseClient,
  measureIds: readonly string[],
  weekEnding: string,
  timezone: string
): Promise<ExternalPanel> {
  const weeks = boardWeeks(weekEnding);
  if (measureIds.length === 0) return { timezone, weeks, byMeasureId: {} };

  const [sourcesRes, entriesRes, logRows] = await Promise.all([
    supabase
      .from("success_measures")
      .select("id, external_source")
      .in("id", measureIds)
      .not("external_source", "is", null),
    supabase
      .from("success_measure_entries")
      .select("measure_id, pulled_at")
      .in("measure_id", measureIds)
      .eq("week_ending", weekEnding)
      .not("origin", "is", null),
    loadReceipts(supabase, measureIds, weekEnding, weekEnding),
  ]);

  const byMeasureId: Record<string, ExternalMeasureInfo> = {};
  const ensure = (id: string): ExternalMeasureInfo => {
    const existing = byMeasureId[id];
    if (existing) return existing;
    const fresh: ExternalMeasureInfo = {
      mapping: null,
      pulledAt: null,
      receipt: null,
    };
    byMeasureId[id] = fresh;
    return fresh;
  };

  for (const row of (sourcesRes.data ?? []) as Array<{
    id: string;
    external_source: unknown;
  }>) {
    ensure(row.id).mapping = parseMapping(row.external_source);
  }

  for (const row of (entriesRes.data ?? []) as Array<{
    measure_id: string;
    pulled_at: string | null;
  }>) {
    ensure(row.measure_id).pulledAt = row.pulled_at;
  }

  const latest = latestByMeasureWeek(logRows);
  for (const [key, row] of latest) {
    const measureId = key.slice(0, key.indexOf(":"));
    ensure(measureId).receipt = buildReceipt(row);
  }

  return { timezone, weeks, byMeasureId };
}
