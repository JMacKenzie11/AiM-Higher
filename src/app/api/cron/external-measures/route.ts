import "server-only";

import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { forEachActiveInstance } from "@/lib/instances/for-each";
import { loadMappedMeasures } from "@/lib/external-measures/service";
import { pullMeasureWeek } from "@/lib/external-measures/run";
import {
  isDueToday,
  isStandardPullDayToday,
  targetWeekEnding,
} from "@/lib/external-measures/schedule";

// Daily cron: every mapped measure whose pull day is today.
//
// ---- WHY DAILY, AT 14:00 UTC ----------------------------------
//
// DAILY because pull_day exists. A mapping set to Monday has to be
// picked up on Monday, and a weekly job cannot do that whatever day
// it runs. Most days most companies have nothing due and the pass is
// three cheap reads.
//
// 14:00 UTC because of what reads entries afterwards:
//
//   this cron            Sat 14:00 UTC
//   performance sweep    Sat 15:00 UTC
//   scorecard snapshot   Sun 07:00 UTC
//
// The scorecard's measures discipline counts entries with
// week_ending in the last seven days, so a Saturday pull of the week
// that closed on Friday is inside Sunday's window. That is the
// sequencing requirement, and it is met by sixteen hours rather than
// by an hour.
//
// The hour in front of the performance sweep is the tighter margin
// and it is not a hope: maxDuration below caps a run at five
// minutes, so this physically cannot overrun into it.
//
// A NOTE ON THE SWEEP, because the margin looks more important than
// it is today. The performance cron calls thisFriday() on a
// Saturday, which returns the Friday six days AHEAD — the week that
// has just begun, not the one that just closed, despite its comments
// saying it means the latter. So today the two jobs look at
// different weeks and cannot collide. If that is fixed to mean what
// it says, this job is already an hour in front of it and the
// ordering holds without anything moving. Chosen so the answer is
// the same either way.
//
// ---- WHY A SEPARATE CRON, not a step inside the sweep ---------
//
// The alternative was to run the pull as the first thing the
// performance cron does, which buys ordering by construction rather
// than by clock. It was rejected on the pull_day requirement alone:
// a step inside a Saturday job cannot serve a Monday mapping.
//
// It also keeps a Sheets outage away from the nudges. A third
// party's API being down should not stop a company's own leaders
// being reminded to log their own numbers.
//
// ---- THE WEEK ---------------------------------------------------
//
// targetWeekEnding is lastFriday in the COMPANY's timezone: the most
// recently completed week. It gives the same answer from Saturday
// through the following Friday, which is what lets a pull_day
// override fill the same week the standard day would have.
//
// Not thisFriday, which is what the manual Pull now uses and is
// right there: a person logging mid-week means the week they are in.
// A scheduler means the week that has numbers.
//
// ---- IDEMPOTENCE ------------------------------------------------
//
// Not implemented here. record_external_pull_scheduled refuses to
// replace any existing entry for the week, typed or previously
// pulled, and reports skipped_exists. So a double fire, a retry and
// a hand re-trigger are all safe without this route checking
// anything first — which is the only way it stays true when
// somebody adds a second caller.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type CompanyRun = {
  companyId: string;
  due: number;
  pulled: number;
  skipped: number;
  failed: number;
  retried: number;
};

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

async function handle(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const summary = await forEachActiveInstance({
    job: "external-measures",
    run: async ({ admin }) => {
      const companies = await companiesWithFlag(admin);

      let due = 0;
      let pulled = 0;
      let skipped = 0;
      let failed = 0;
      let retried = 0;
      const perCompany: CompanyRun[] = [];

      for (const company of companies) {
        const result = await runForCompany(admin, company.id, company.timezone);
        due += result.due;
        pulled += result.pulled;
        skipped += result.skipped;
        failed += result.failed;
        retried += result.retried;
        perCompany.push(result);
      }

      return {
        companies: companies.length,
        due,
        pulled,
        skipped,
        failed,
        retried,
        perCompany,
        // A failing MEASURE is a normal outcome with a receipt behind
        // it, not an instance failure — the week stays awaiting and
        // the accountable person's existing nudge covers it. But a
        // run where everything failed is a broken credential or a
        // broken API, and the monitor has to see that. Non-2xx when
        // anything failed, per the standing convention.
        ok: failed === 0,
      };
    },
    line: (r) =>
      `${r.companies} companies, ${r.due} due, ${r.pulled} pulled, ` +
      `${r.skipped} skipped, ${r.failed} failed` +
      (r.retried > 0 ? `, ${r.retried} retried` : ""),
  });

  // Two ways this run is not ok: an instance threw, or a measure
  // failed anywhere. Both have to reach the monitor, and a cron that
  // returns 200 with failures inside it looks healthy in Vercel's
  // history forever.
  const anyMeasureFailed = summary.outcomes.some(
    (o) => o.result !== null && o.result.failed > 0
  );
  const ok = summary.ok && !anyMeasureFailed;
  return Response.json(summary, { status: ok ? 200 : 500 });
}

async function companiesWithFlag(
  admin: SupabaseClient
): Promise<Array<{ id: string; timezone: string }>> {
  const { data } = await admin
    .from("company_features")
    .select("company_id, companies!inner(id, timezone)")
    .eq("feature", "external_measures");
  type Row = {
    company_id: string;
    companies:
      | { id: string; timezone: string }
      | Array<{ id: string; timezone: string }>;
  };
  return ((data ?? []) as Row[]).map((r) => {
    const c = Array.isArray(r.companies) ? r.companies[0] : r.companies;
    return {
      id: r.company_id,
      timezone: c?.timezone ?? "America/Anchorage",
    };
  });
}

async function runForCompany(
  admin: SupabaseClient,
  companyId: string,
  timezone: string
): Promise<CompanyRun> {
  const weekEnding = targetWeekEnding(timezone);
  const measures = await loadMappedMeasures(admin, companyId);

  // A mapping that will not parse has no pull_day to read, so it is
  // due on the STANDARD day and logged as a failure there. Not every
  // day: the first draft of this line read `m.mapping === null ||
  // isDueToday(...)`, which would have written a failure receipt for
  // a broken mapping seven times a week forever. Once a week is a
  // signal; daily is a thing people filter out.
  //
  // Silently skipping it is the other wrong answer, and the worse
  // one: "configured wrongly" and "not configured" look identical
  // from a chart that stopped moving, which is the state this whole
  // feature exists to make visible.
  const standardDay = isStandardPullDayToday(timezone);
  const due = measures.filter((m) =>
    m.mapping === null ? standardDay : isDueToday(m.mapping, timezone)
  );

  const run: CompanyRun = {
    companyId,
    due: due.length,
    pulled: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
  };

  // Sequential. These are reads of somebody else's API and firing a
  // company's measures at it at once is how a working integration
  // becomes a rate limit that presents as "the sheet could not be
  // read".
  for (const measure of due) {
    try {
      const result = await pullMeasureWeek(admin, {
        path: "scheduled",
        measureId: measure.measureId,
        companyId,
        weekEnding,
        mapping: measure.mapping,
        rawSource: measure.rawSource,
      });
      if (result.attempts > 1) run.retried += 1;
      if (result.outcome === "written") run.pulled += 1;
      else if (result.outcome === "failed") run.failed += 1;
      else run.skipped += 1;
    } catch (err) {
      // pullMeasureWeek only throws when the RECEIPT could not be
      // written, which means nothing can be said about what happened
      // to that measure. Counted as failed and the loop continues:
      // one measure's database error must not cost the rest of the
      // company its week.
      run.failed += 1;
      console.error(
        `[external-measures] ${companyId} ${measure.measureId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return run;
}
