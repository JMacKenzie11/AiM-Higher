import "server-only";

import { NextRequest } from "next/server";
import {
  computeCompanyScorecard,
  writeScorecardSnapshot,
} from "@/lib/maturity/compute";
import { forEachActiveInstance } from "@/lib/instances/for-each";

// Weekly cron for the AiMS Scorecard.
//
// Iterates every non-archived company, computes the current live
// scorecard, and upserts one snapshot row per (company, today,
// discipline). Snapshot date is the CURRENT day in the company's
// local timezone (handled inside writeScorecardSnapshot), so a cron
// firing at 05:00 UTC doesn't tag Anchorage rows with yesterday.
//
// Idempotent — a mid-week re-run overwrites the day's rows cleanly
// via the (company_id, snapshot_date, discipline) unique constraint.
//
// The /scorecard page ALSO computes live on every load, so a delayed
// cron never leaves the page stale; the snapshot table only powers
// the historical trend line.
//
// Runs against every active instance. The per-company logic below
// is untouched: it already took an `admin` client, so fanning out
// means handing it a different one each time round.
//
// Vercel cron entry lives in vercel.json.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

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
    job: "scorecard",
    run: async ({ admin }) => {
      const { data: companies, error: listError } = await admin
        .from("companies")
        .select("id, name")
        .eq("status", "active");
      // Throwing rather than returning: failing to list an
      // instance's companies means this instance did no work at all,
      // which is an instance-level failure. A single company failing
      // below is not, and is still collected the way it always was.
      if (listError) throw new Error(listError.message);

      const rows = (companies ?? []) as Array<{ id: string; name: string }>;
      const results: Array<{
        companyId: string;
        ok: boolean;
        // Feature-gated disciplines that resolved ON for this company.
        // Present only on a successful compute.
        gatedEnabled?: number;
        gatedTotal?: number;
        error?: string;
      }> = [];

      // Sequential rather than parallel — each company runs 6 small
      // reads, but a Promise.all across every tenant could spike
      // Supabase connection pressure on a large customer base. Serial
      // is plenty fast at platform sizes we care about.
      for (const c of rows) {
        try {
          const scorecard = await computeCompanyScorecard(c.id, admin);
          const write = await writeScorecardSnapshot(c.id, scorecard, admin);
          if (!write.ok) {
            results.push({ companyId: c.id, ok: false, error: write.message });
          } else {
            results.push({
              companyId: c.id,
              ok: true,
              gatedEnabled: scorecard.gating.enabled,
              gatedTotal: scorecard.gating.total,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ companyId: c.id, ok: false, error: message });
        }
      }

      const ok = results.filter((r) => r.ok);
      return {
        processed: results.length,
        succeeded: ok.length,
        failed: results.length - ok.length,
        // Feature-gated disciplines enabled across the companies that
        // snapshotted. This is in the summary because the alternative
        // is what already happened: entitlements resolved empty for
        // every company for three weeks, four disciplines recorded
        // themselves as "not enabled", and every run still reported a
        // clean "8/8 companies snapshotted, 0 failed". A 0/N here is
        // the tell, and it costs one number to have it.
        gatedEnabled: ok.reduce((n, r) => n + (r.gatedEnabled ?? 0), 0),
        gatedTotal: ok.reduce((n, r) => n + (r.gatedTotal ?? 0), 0),
        // Per company too, so a single tenant whose entitlements went
        // missing is visible and not averaged away by the fleet.
        perCompany: ok.map((r) => ({
          companyId: r.companyId,
          gatedEnabled: r.gatedEnabled ?? 0,
        })),
        // Only surface the first few failures — no need to dump 200
        // error strings for a rare wholesale outage.
        failures: results.filter((r) => !r.ok).slice(0, 20),
      };
    },
    line: (r) =>
      `${r.succeeded}/${r.processed} companies snapshotted, ${r.failed} failed, ` +
      `${r.gatedEnabled}/${r.gatedTotal} feature-gated disciplines enabled`,
  });

  return Response.json(summary, { status: summary.ok ? 200 : 500 });
}
