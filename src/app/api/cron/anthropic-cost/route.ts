import "server-only";

import { NextRequest } from "next/server";
import {
  fetchDailyCost,
  readAnthropicCostConfig,
  upsertDailyCost,
} from "@/lib/admin/anthropic-cost";

// Nightly Anthropic Admin API pull. Fetches the last 30 days of
// cost data filtered to the AiMHigher workspace and upserts a
// row per day into anthropic_daily_cost.
//
// 30-day window each night is intentional over-fetch: it self-
// backfills the first run and self-corrects any late-arriving
// revisions Anthropic may issue for recent days. The upsert
// replaces existing rows on bucket_date, so re-runs are safe.
//
// Auth: standard CRON_SECRET bearer. Config: reads
// ANTHROPIC_ADMIN_KEY and ANTHROPIC_WORKSPACE_ID from env; both
// must be present or the run is a no-op (dashboard falls back
// to the local estimator until they're configured).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const BACKFILL_DAYS = 30;

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

  const config = readAnthropicCostConfig();
  if (!config) {
    return Response.json({
      status: "skipped",
      reason:
        "ANTHROPIC_ADMIN_KEY and ANTHROPIC_WORKSPACE_ID env vars are required for real cost tracking",
    });
  }

  try {
    const rows = await fetchDailyCost(config, BACKFILL_DAYS);
    const { inserted } = await upsertDailyCost(rows);
    return Response.json({
      status: "ok",
      workspaceId: config.workspaceId,
      daysReturned: rows.length,
      upserted: inserted,
      totalCents: Math.round(
        rows.reduce((s, r) => s + r.amount_cents, 0)
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("anthropic-cost cron failed", err);
    return new Response(
      JSON.stringify({ status: "error", reason: message }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
