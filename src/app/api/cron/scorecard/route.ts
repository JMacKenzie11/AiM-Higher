import "server-only";

import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  computeCompanyScorecard,
  writeScorecardSnapshot,
} from "@/lib/maturity/compute";

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

  const admin = createSupabaseAdminClient();

  const { data: companies, error: listError } = await admin
    .from("companies")
    .select("id, name")
    .eq("status", "active");
  if (listError) {
    return Response.json(
      { ok: false, message: listError.message },
      { status: 500 }
    );
  }

  const rows = (companies ?? []) as Array<{ id: string; name: string }>;
  const results: Array<{
    companyId: string;
    ok: boolean;
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
        results.push({ companyId: c.id, ok: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ companyId: c.id, ok: false, error: message });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  return Response.json({
    ok: true,
    processed: results.length,
    succeeded: okCount,
    failed: failCount,
    // Only surface the first few failures — no need to dump 200
    // error strings for a rare wholesale outage.
    failures: results.filter((r) => !r.ok).slice(0, 20),
  });
}
