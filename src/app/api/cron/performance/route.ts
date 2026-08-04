import "server-only";

import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fridayOf, thisFriday } from "@/lib/dates";

// Weekly nudge: for every company that has performance_tracking on,
// check each active auto_track success measure for a value in the
// current week. If one is missing, create an open commitment on the
// function's leader (or unassigned if the seat is empty) so the
// operator sees "log this" as a task next time they open Commitments.
//
// Only fires on missed updates — not on off-target values. The
// "below target" story lives in the dashboard cards, not in a
// commitment. See docs/help/measures.md for the design rationale.
//
// Dedupe: for each (measure, week) pair, we look for an existing
// commitment whose description starts with the same "Update … week
// ending Y-MM-DD" pattern before inserting. Re-running the cron in
// the same week is a no-op.

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
  const perCompany: Array<{ companyId: string; created: number }> = [];

  for (const company of companies) {
    const created = await runForCompany(admin, company.id, company.timezone);
    totalCreated += created;
    perCompany.push({ companyId: company.id, created });
  }

  return Response.json({ totalCreated, perCompany });
}

export const GET = POST;

async function runForCompany(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  companyId: string,
  timezone: string
): Promise<number> {
  const weekEnding = thisFriday(timezone);

  // Every auto_track measure in the company, with the parent
  // function so we know the seat holder.
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
  if (functions.length === 0) return 0;
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
  if (outcomes.length === 0) return 0;
  const fnIdByOutcome = new Map(outcomes.map((o) => [o.id, o.function_id]));

  const { data: measureRows } = await admin
    .from("success_measures")
    .select("id, description, outcome_id, auto_track, archived")
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
  }>;
  if (measures.length === 0) return 0;

  // Existing entries for the week — one query, then filter.
  const { data: entryRows } = await admin
    .from("success_measure_entries")
    .select("measure_id")
    .in(
      "measure_id",
      measures.map((m) => m.id)
    )
    .eq("week_ending", weekEnding);
  const loggedIds = new Set(
    ((entryRows ?? []) as Array<{ measure_id: string }>).map((e) => e.measure_id)
  );

  const missing = measures.filter((m) => !loggedIds.has(m.id));
  if (missing.length === 0) return 0;

  // Existing commitments for the week that match our pattern —
  // one query for dedupe.
  const cutoffFriday = fridayOf(weekEnding);
  const { data: existingRows } = await admin
    .from("commitments")
    .select("description")
    .eq("company_id", companyId)
    .eq("week_ending", cutoffFriday);
  const existingDescriptions = new Set(
    ((existingRows ?? []) as Array<{ description: string }>).map(
      (r) => r.description
    )
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

  for (const m of missing) {
    const fnId = fnIdByOutcome.get(m.outcome_id);
    const fn = fnId ? fnById.get(fnId) : null;
    const description = `Log this week's value for "${m.description}"`;
    if (existingDescriptions.has(description)) continue;
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
  }

  if (rowsToInsert.length === 0) return 0;

  const { data: inserted } = await admin
    .from("commitments")
    .insert(rowsToInsert)
    .select("id");
  return (inserted ?? []).length;
}
