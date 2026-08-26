import "server-only";

import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { addDays, fridayOf, thisFriday } from "@/lib/dates";
import type { MetricValueType, TargetDirection } from "@/lib/types";

// Weekly Saturday cron for companies on `performance_tracking`.
// Two nudges land on the function leader's Functional Commitments
// board:
//
//   1. "Log this week's value for X" — the measure has no entry
//      for the just-closed week. Same-week due date (the leader can
//      log now and mark kept-late).
//   2. "Off target this week: X (value vs. target Y)" — the measure
//      has an entry that missed the target. Due NEXT Friday, so the
//      leader has the upcoming week to think through and act on it.
//
// Both nudges only fire for `auto_track = true` measures. Context
// measures (headcount, etc.) opt out via auto_track = false.
//
// Dedupe: for each (measure, week) pair, both flavours check for
// an existing commitment whose description matches the pattern
// before inserting. Re-running the cron in the same week is a
// no-op.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  // Companies that opted in.
  const { data: companyRows } = await admin
    .from("company_features")
    .select("company_id, companies!inner(id, timezone)")
    .eq("feature", "performance_tracking");
  type CompanyJoin = {
    company_id: string;
    companies:
      | { id: string; timezone: string }
      | Array<{ id: string; timezone: string }>;
  };
  const companies = ((companyRows ?? []) as CompanyJoin[]).map((r) => {
    const c = Array.isArray(r.companies) ? r.companies[0] : r.companies;
    return { id: r.company_id, timezone: c?.timezone ?? "America/Anchorage" };
  });

  let totalCreated = 0;
  const perCompany: Array<{
    companyId: string;
    createdMissing: number;
    createdOffTarget: number;
  }> = [];

  for (const company of companies) {
    const result = await runForCompany(admin, company.id, company.timezone);
    totalCreated += result.createdMissing + result.createdOffTarget;
    perCompany.push({
      companyId: company.id,
      createdMissing: result.createdMissing,
      createdOffTarget: result.createdOffTarget,
    });
  }

  return Response.json({ totalCreated, perCompany });
}

export const GET = POST;

async function runForCompany(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  companyId: string,
  timezone: string
): Promise<{ createdMissing: number; createdOffTarget: number }> {
  const weekEnding = thisFriday(timezone);
  const cutoffFriday = fridayOf(weekEnding);
  const nextFriday = addDays(cutoffFriday, 7);

  const { data: fnRows } = await admin
    .from("functions")
    .select("id, title, leader_id")
    .eq("company_id", companyId)
    .eq("archived", false);
  const functions = (fnRows ?? []) as Array<{
    id: string;
    title: string;
    leader_id: string | null;
  }>;
  if (functions.length === 0) {
    return { createdMissing: 0, createdOffTarget: 0 };
  }
  const fnById = new Map(functions.map((f) => [f.id, f]));

  const { data: outcomeRows } = await admin
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
  if (outcomes.length === 0) {
    return { createdMissing: 0, createdOffTarget: 0 };
  }
  const fnIdByOutcome = new Map(outcomes.map((o) => [o.id, o.function_id]));

  const { data: measureRows } = await admin
    .from("success_measures")
    .select(
      "id, description, outcome_id, target, value_type, target_direction, auto_track, archived"
    )
    .in(
      "outcome_id",
      outcomes.map((o) => o.id)
    )
    .eq("archived", false)
    .eq("auto_track", true);
  const measures = (measureRows ?? []) as Array<{
    id: string;
    description: string;
    outcome_id: string;
    target: string | null;
    value_type: MetricValueType;
    target_direction: TargetDirection;
  }>;
  if (measures.length === 0) {
    return { createdMissing: 0, createdOffTarget: 0 };
  }

  // Entries for the just-closed week (missing + values in one query).
  const { data: entryRows } = await admin
    .from("success_measure_entries")
    .select("measure_id, value_number, value_text")
    .in(
      "measure_id",
      measures.map((m) => m.id)
    )
    .eq("week_ending", weekEnding);
  const entryByMeasure = new Map(
    ((entryRows ?? []) as Array<{
      measure_id: string;
      value_number: number | null;
      value_text: string | null;
    }>).map((e) => [e.measure_id, e])
  );

  // Split into two buckets: missing entries vs. off-target entries.
  // A measure with no target can be missing (log-this fires) but
  // can't be off-target — so it never enters the off bucket.
  const missing: typeof measures = [];
  const offTarget: Array<{
    measure: (typeof measures)[number];
    displayValue: string;
    displayTarget: string;
  }> = [];
  for (const m of measures) {
    const entry = entryByMeasure.get(m.id);
    if (!entry) {
      missing.push(m);
      continue;
    }
    if (!m.target) continue;
    if (isOffTarget(m, entry.value_number, entry.value_text)) {
      offTarget.push({
        measure: m,
        displayValue: formatValue(m.value_type, entry.value_number, entry.value_text),
        displayTarget: formatTarget(m.target, m.value_type, m.target_direction),
      });
    }
  }

  if (missing.length === 0 && offTarget.length === 0) {
    return { createdMissing: 0, createdOffTarget: 0 };
  }

  // Dedupe pool covers both weeks the cron writes to — the just-
  // closed Friday (missing) and next Friday (off-target).
  const { data: existingRows } = await admin
    .from("commitments")
    .select("description, week_ending")
    .eq("company_id", companyId)
    .in("week_ending", [cutoffFriday, nextFriday]);
  const existingKeys = new Set(
    ((existingRows ?? []) as Array<{
      description: string;
      week_ending: string;
    }>).map((r) => `${r.week_ending}::${r.description}`)
  );

  const rowsToInsert: Array<{
    company_id: string;
    priority_id: null;
    owner_id: string | null;
    description: string;
    week_ending: string;
    due_date: string;
    status: "open";
    source_meeting_id: null;
  }> = [];
  let plannedMissing = 0;
  let plannedOffTarget = 0;

  for (const m of missing) {
    const fnId = fnIdByOutcome.get(m.outcome_id);
    const fn = fnId ? fnById.get(fnId) : null;
    const description = `Log this week's value for "${m.description}"`;
    if (existingKeys.has(`${cutoffFriday}::${description}`)) continue;
    rowsToInsert.push({
      company_id: companyId,
      priority_id: null,
      owner_id: fn?.leader_id ?? null,
      description,
      week_ending: cutoffFriday,
      due_date: cutoffFriday,
      status: "open",
      source_meeting_id: null,
    });
    plannedMissing += 1;
  }

  for (const item of offTarget) {
    const { measure: m, displayValue, displayTarget } = item;
    const fnId = fnIdByOutcome.get(m.outcome_id);
    const fn = fnId ? fnById.get(fnId) : null;
    const description = `Off target this week: "${m.description}" (${displayValue} vs. target ${displayTarget})`;
    if (existingKeys.has(`${nextFriday}::${description}`)) continue;
    rowsToInsert.push({
      company_id: companyId,
      priority_id: null,
      owner_id: fn?.leader_id ?? null,
      description,
      week_ending: nextFriday,
      due_date: nextFriday,
      status: "open",
      source_meeting_id: null,
    });
    plannedOffTarget += 1;
  }

  if (rowsToInsert.length === 0) {
    return { createdMissing: 0, createdOffTarget: 0 };
  }

  const { data: inserted } = await admin
    .from("commitments")
    .insert(rowsToInsert)
    .select("id");
  const totalInserted = (inserted ?? []).length;
  // If the insert partially failed we can't easily split the count
  // by bucket, so treat the split as best-effort (matches the pre-
  // 2026-08 behaviour where the log-this nudge just returned the
  // insert count).
  if (totalInserted === plannedMissing + plannedOffTarget) {
    return {
      createdMissing: plannedMissing,
      createdOffTarget: plannedOffTarget,
    };
  }
  return { createdMissing: totalInserted, createdOffTarget: 0 };
}

// ---- Off-target comparison + display helpers --------------------
// Mirrors the client-side compareCellToTarget in MeasuresManager so
// server-side nudges and the manager's status colouring stay in
// sync. Duplicated deliberately: the client module carries "use
// client" boundaries the cron shouldn't cross.

function isOffTarget(
  measure: {
    value_type: MetricValueType;
    target: string | null;
    target_direction: TargetDirection;
  },
  n: number | null,
  t: string | null
): boolean {
  if (!measure.target) return false;
  if (measure.value_type === "text") {
    const left = (t ?? "").trim().toLowerCase();
    const right = measure.target.trim().toLowerCase();
    if (!left) return false; // treated as unlogged, not off
    return left !== right;
  }
  if (n == null || !Number.isFinite(n)) return false;
  const target = parseTargetNumber(measure.target);
  if (target == null) return false;
  const hit =
    measure.target_direction === "lower_is_better" ? n <= target : n >= target;
  return !hit;
}

function parseTargetNumber(target: string | null): number | null {
  if (!target) return null;
  const cleaned = target.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatValue(
  valueType: MetricValueType,
  n: number | null,
  t: string | null
): string {
  if (valueType === "text") return (t ?? "").trim();
  if (n == null || !Number.isFinite(n)) return "";
  if (valueType === "percent") return `${n}%`;
  return String(n);
}

function formatTarget(
  target: string,
  valueType: MetricValueType,
  direction: TargetDirection
): string {
  const symbol = direction === "lower_is_better" ? "≤ " : "≥ ";
  // Percent value_type gets the % suffix if the target text doesn't
  // already carry one, so "95" reads as "95%" in the description.
  const withUnit =
    valueType === "percent" && !target.includes("%") ? `${target}%` : target;
  return `${symbol}${withUnit}`;
}
