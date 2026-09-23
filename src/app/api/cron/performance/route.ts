import "server-only";

import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fridayOf, lastFriday } from "@/lib/dates";
import type {
  MetricValueType,
  TargetDirection,
  UpdateFrequency,
} from "@/lib/types";
import { isDueForWeek } from "@/lib/measures/frequency";
import { isOffTarget, raiseOffTargetIssue } from "@/lib/measures/off-target";
import { forEachActiveInstance } from "@/lib/instances/for-each";

// TUESDAY cron for companies on `performance_tracking`.
//
// ---- WHY TUESDAY AND NOT SATURDAY -----------------------------
//
// It ran Saturday 15:00 UTC, which is the first hour of the grace
// period rather than the end of it. The week closes on Friday; by
// Saturday afternoon nobody has had a working day to enter a number,
// and the job that turns a missing value into a commitment on a
// person was firing before that person had a chance. Decided
// 2026-09-19: give them through the end of Monday.
//
// 12:00 UTC on Tuesday is past midnight Monday in every timezone the
// fleet uses. The westernmost is America/Anchorage (UTC-9/-8), where
// this lands 03:00–04:00 Tuesday; on the eastern side it is 08:00–
// 09:00. All Tuesday morning, all after Monday has ended.
//
// THE TARGET WEEK IS UNCHANGED, and that is not luck. lastFriday()
// gives the most recently completed week every day from Saturday
// through the following Friday, so Saturday and Tuesday both resolve
// to the same Friday. Only the moment of asking moved.
//
// ---- WHICH WEEK, AND WHY IT WAS WRONG -------------------------
//
// This read thisFriday(timezone). It runs on a Saturday, and on a
// Saturday thisFriday() is the Friday SIX DAYS AHEAD: the week that
// has just begun, not the one that just closed, despite everything
// below saying otherwise. Two consequences, both measured on the
// clone before this was changed:
//
//   Off-target NEVER FIRED. Not once, on any instance, since the
//   branch was written — `select count(*) from issues where title
//   like 'Off target:%'` returned 0, with no first and no last. The
//   branch runs only when an entry exists, and no entry can exist
//   for a week that is one day old.
//
//   The nudge fired UNCONDITIONALLY. 26 commitments for the week
//   ending 18 Sep, created on the Saturday that week began, when
//   nobody could have logged anything yet. That is not a reminder,
//   it is a weekly chore list that cannot be satisfied at the moment
//   it is created.
//
// Both now read the week that JUST CLOSED, which is the only week
// either question means anything about: a value is final, and
// "did anybody log it" has a real answer.
//
// ---- WHAT THIS DOES NOT KNOW ABOUT ----------------------------
//
// External measures. Deliberately, and it must stay that way.
//
// The external-measures cron runs at 14:00 UTC, an hour before this
// one, and fills the same closed week where it can. So a pulled
// measure has a value here and is not nudged — without this file
// containing a single line about mappings. It looks for a VALUE.
//
// Skipping mapped measures outright would be the obvious shortcut
// and is the opposite of what anybody wants: when a client's sheet
// breaks, the value is absent, and the person accountable has to be
// chased exactly as if they had forgotten. Pinned by
// src/lib/external-measures/rhythm.test.ts.
//
// Two very different things happen when a measure needs attention,
// and they are no longer treated the same way:
//
//   1. NO VALUE LOGGED → a commitment on the function leader.
//      "Log last week's value for X". This is an administrative
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
//
// Runs against every active instance. runForCompany below is
// unchanged; it already took an `admin` client, so fanning out is a
// matter of which client it is given.

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

  const summary = await forEachActiveInstance({
    job: "performance",
    run: async ({ admin }) => {
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
        return {
          id: r.company_id,
          timezone: c?.timezone ?? "America/Anchorage",
        };
      });

      let createdOffTarget = 0;
      const perCompany: Array<{
        companyId: string;
        createdOffTarget: number;
      }> = [];

      for (const company of companies) {
        const result = await runForCompany(admin, company.id, company.timezone);
        createdOffTarget += result.createdOffTarget;
        perCompany.push({
          companyId: company.id,
          createdOffTarget: result.createdOffTarget,
        });
      }

      return {
        companies: companies.length,
        createdOffTarget,
        totalCreated: createdOffTarget,
        perCompany,
      };
    },
    line: (r) =>
      `${r.companies} companies, ${r.createdOffTarget} off-target issues`,
  });

  return Response.json(summary, { status: summary.ok ? 200 : 500 });
}

export const GET = POST;

async function runForCompany(
  admin: SupabaseClient,
  companyId: string,
  timezone: string
): Promise<{ createdOffTarget: number }> {
  // The week that just closed: its numbers are final, so "is this
  // under target" has an answer that will not change.
  const weekJustClosed = lastFriday(timezone);

  // Functions, only to scope the measures below to this company.
  // The lead and the title went with the commitments — a lead was
  // who the nudge was assigned TO, and nothing here is assigned to
  // anybody now.
  const { data: fnRows } = await admin
    .from("functions")
    .select("id")
    .eq("company_id", companyId)
    .eq("archived", false);
  const functions = (fnRows ?? []) as Array<{ id: string }>;
  if (functions.length === 0) {
    return { createdOffTarget: 0 };
  }

  // Measures by function (migration 0166). Both kinds: a CSF with a
  // target and reminders on is chased like any other measure.
  const { data: measureRows } = await admin
    .from("success_measures")
    .select(
      "id, description, function_id, target, value_type, target_direction, update_frequency, created_at, archived"
    )
    .in(
      "function_id",
      functions.map((f) => f.id)
    )
    .eq("archived", false);
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
    return { createdOffTarget: 0 };
  }

  // Only chase a measure on a Friday it is actually expected to
  // report. A fortnightly measure is asked every other week, a
  // monthly one roughly every fourth, anchored to when it was created
  // so a five-Friday month does not shift its rhythm.
  const due = measures.filter((m) =>
    isDueForWeek({
      frequency: m.update_frequency ?? "weekly",
      weekEndingFriday: weekJustClosed,
      anchorFriday: fridayOf(m.created_at.slice(0, 10)),
    })
  );
  if (due.length === 0) {
    return { createdOffTarget: 0 };
  }

  // Entries for the just-closed week (missing + values in one query).
  // This is where a pulled value arrives: the external-measures cron
  // wrote it an hour ago, and to this code it is simply an entry.
  const { data: entryRows } = await admin
    .from("success_measure_entries")
    .select("measure_id, value_number, value_text")
    .in(
      "measure_id",
      due.map((m) => m.id)
    )
    .eq("week_ending", weekJustClosed);
  const entryByMeasure = new Map(
    ((entryRows ?? []) as Array<{
      measure_id: string;
      value_number: number | null;
      value_text: string | null;
    }>).map((e) => [e.measure_id, e])
  );

  // ---- A MISSING VALUE IS A REMINDER, NOT A COMMITMENT --------
  //
  // This used to open a "Log last week's value for X" commitment on
  // the function's lead for every measure with no entry. It is gone.
  //
  // Why: a commitment is a promise somebody made. One the system
  // wrote on your behalf because you had not typed a number yet is
  // not that, and it arrived in the same list as the promises you
  // did make, with a due date and a red row when it passed. The
  // nudge belongs in the notification tray, which already has a
  // Friday "Log this week's numbers" item aimed at the same person.
  //
  // This was already known. Migration 0166 set auto_track FALSE on
  // every CSF it migrated, and said why: "Defaulting migrated CSFs
  // to true would hand every function leader a pile of new
  // commitments the moment the cron is restored." The fix there was
  // to silence 76 of 89 measures one at a time. Removing the
  // behaviour is the fix that does not need repeating.
  //
  // It also takes a bug with it. The dedupe pool was read once
  // before the loop, so it caught a repeat from LAST week and not
  // two measures sharing a description in THIS batch. Three measures
  // called "# Zero Lost Time Incidents" produced three identical
  // commitments in one run, on one real company, every week the
  // feature was on.
  //
  // An under-target value still raises an Issue. That is a thing to
  // discuss, not a reminder to type something.
  const offTarget: Array<(typeof due)[number]> = [];
  for (const m of due) {
    const entry = entryByMeasure.get(m.id);
    // No entry is no longer this job's business. The tray asks.
    if (!entry) continue;
    if (
      isOffTarget(m, { number: entry.value_number, text: entry.value_text })
    ) {
      offTarget.push(m);
    }
  }

  if (offTarget.length === 0) return { createdOffTarget: 0 };

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

  return { createdOffTarget };
}
