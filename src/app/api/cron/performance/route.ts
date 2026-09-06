import "server-only";

import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fridayOf, thisFriday } from "@/lib/dates";
import type {
  MetricValueType,
  TargetDirection,
  UpdateFrequency,
} from "@/lib/types";
import { isDueForWeek } from "@/lib/measures/frequency";
import { isOffTarget, raiseOffTargetIssue } from "@/lib/measures/off-target";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Saturday cron for companies on `performance_tracking`.
//
// Two very different things happen when a measure needs attention,
// and they are no longer treated the same way:
//
//   1. NO VALUE LOGGED → a commitment on the function leader.
//      "Log this week's value for X". This is an administrative
//      reminder about data entry, not a problem with the business.
//      Routing it to the issues list would fill that list with
//      clerical noise and devalue it.
//
//   2. VALUE UNDER TARGET → an ISSUE on the company's issues list.
//      Something is not working and the team has to decide what to
//      do, which is the Solution Seeking discipline. Before this it
//      created a commitment, because it was built before issues
//      existed.
//
// The off-target rule lives in lib/measures/off-target.ts, NOT here,
// because an external system feeding a KPI has to raise the same
// issue a hand-entered value does. Two callers, one rule.
//
// Frequency: a measure is only chased on the Fridays it is actually
// expected to report. Before this, weekly was assumed, so a monthly
// measure was nagged every week and looked permanently delinquent.
//
// Both kinds are swept. A CSF is a measure now, and one that has been
// given a target and asked to be tracked deserves the same attention
// as a KPI.

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

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());

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
  admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
  companyId: string,
  timezone: string
): Promise<{ createdMissing: number; createdOffTarget: number }> {
  const weekEnding = thisFriday(timezone);
  const cutoffFriday = fridayOf(weekEnding);

  const { data: fnRows } = await admin
    .from("functions")
    .select("id, title, lead_id")
    .eq("company_id", companyId)
    .eq("archived", false);
  const functions = (fnRows ?? []) as Array<{
    id: string;
    title: string;
    lead_id: string | null;
  }>;
  if (functions.length === 0) {
    return { createdMissing: 0, createdOffTarget: 0 };
  }
  const fnById = new Map(functions.map((f) => [f.id, f]));

  // Measures by function (migration 0166). Both kinds: a CSF with a
  // target and reminders on is chased like any other measure.
  const { data: measureRows } = await admin
    .from("success_measures")
    .select(
      "id, description, function_id, target, value_type, target_direction, update_frequency, created_at, auto_track, archived"
    )
    .in(
      "function_id",
      functions.map((f) => f.id)
    )
    .eq("archived", false)
    .eq("auto_track", true);
  const measures = (measureRows ?? []) as Array<{
    id: string;
    description: string;
    function_id: string | null;
    target: string | null;
    value_type: MetricValueType;
    target_direction: TargetDirection;
    update_frequency: UpdateFrequency;
    created_at: string;
  }>;
  if (measures.length === 0) {
    return { createdMissing: 0, createdOffTarget: 0 };
  }

  // Only chase a measure on a Friday it is actually expected to
  // report. A fortnightly measure is asked every other week, a
  // monthly one roughly every fourth, anchored to when it was created
  // so a five-Friday month does not shift its rhythm.
  const due = measures.filter((m) =>
    isDueForWeek({
      frequency: m.update_frequency ?? "weekly",
      weekEndingFriday: weekEnding,
      anchorFriday: fridayOf(m.created_at.slice(0, 10)),
    })
  );
  if (due.length === 0) {
    return { createdMissing: 0, createdOffTarget: 0 };
  }

  // Entries for the just-closed week (missing + values in one query).
  const { data: entryRows } = await admin
    .from("success_measure_entries")
    .select("measure_id, value_number, value_text")
    .in(
      "measure_id",
      due.map((m) => m.id)
    )
    .eq("week_ending", weekEnding);
  const entryByMeasure = new Map(
    ((entryRows ?? []) as Array<{
      measure_id: string;
      value_number: number | null;
      value_text: string | null;
    }>).map((e) => [e.measure_id, e])
  );

  // Missing values become commitments; under-target values become
  // issues. A measure with no target can be missing but can never be
  // off target, which is what keeps an untargeted CSF quiet.
  const missing: typeof due = [];
  const offTarget: Array<(typeof due)[number]> = [];
  for (const m of due) {
    const entry = entryByMeasure.get(m.id);
    if (!entry) {
      missing.push(m);
      continue;
    }
    if (
      isOffTarget(m, { number: entry.value_number, text: entry.value_text })
    ) {
      offTarget.push(m);
    }
  }

  if (missing.length === 0 && offTarget.length === 0) {
    return { createdMissing: 0, createdOffTarget: 0 };
  }

  // Dedupe pool for the missing-value commitments only. Off-target
  // now writes issues, which dedupe themselves inside
  // raiseOffTargetIssue against any open issue with the same title.
  const { data: existingRows } = await admin
    .from("commitments")
    .select("description, week_ending")
    .eq("company_id", companyId)
    .eq("week_ending", cutoffFriday);
  const existingKeys = new Set(
    ((existingRows ?? []) as Array<{
      description: string;
      week_ending: string;
    }>).map((r) => `${r.week_ending}::${r.description}`)
  );

  const rowsToInsert: Array<{
    company_id: string;
    priority_id: null;
    functional_area_id: string | null;
    owner_id: string | null;
    description: string;
    week_ending: string;
    due_date: string;
    status: "open";
    source_meeting_id: null;
  }> = [];
  let plannedMissing = 0;

  for (const m of missing) {
    const fn = m.function_id ? fnById.get(m.function_id) : null;
    const description = `Log this week's value for "${m.description}"`;
    if (existingKeys.has(`${cutoffFriday}::${description}`)) continue;
    rowsToInsert.push({
      company_id: companyId,
      priority_id: null,
      // Auto-created nudge commitments carry the function that owns
      // the measure as their functional area link, so they show up
      // on the company /commitments page under the correct lane and
      // roll up to the right seat in weekly-review views.
      functional_area_id: m.function_id ?? null,
      owner_id: fn?.lead_id ?? null,
      description,
      week_ending: cutoffFriday,
      due_date: cutoffFriday,
      status: "open",
      source_meeting_id: null,
    });
    plannedMissing += 1;
  }

  // Off target raises issues, one call per measure, through the same
  // function an integration will call. Sequential rather than
  // parallel: each one checks for an existing open issue first, and
  // firing them together would race two identical inserts.
  let createdOffTarget = 0;
  for (const m of offTarget) {
    const entry = entryByMeasure.get(m.id);
    if (!entry) continue;
    const result = await raiseOffTargetIssue(admin, {
      companyId,
      measure: m,
      value: { number: entry.value_number, text: entry.value_text },
      // A sweep has no author. The issue shows as system-raised.
      createdBy: null,
    });
    if (result.raised) createdOffTarget += 1;
  }

  if (rowsToInsert.length === 0) {
    return { createdMissing: 0, createdOffTarget };
  }

  const { data: inserted } = await admin
    .from("commitments")
    .insert(rowsToInsert)
    .select("id");
  return {
    createdMissing: (inserted ?? []).length,
    createdOffTarget,
  };
}
