import "server-only";

import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestSource, processPendingMeetings } from "@/lib/transcripts/ingest";
import type { TranscriptSource } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Vercel Cron target — configured in vercel.json to run every 15 min.
// Authenticated with a bearer token so a random public request can't
// trigger the ingestion + analysis pipeline (which spends money and
// sends emails).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The Anthropic + Drive round-trips per source can add up. Vercel's
// hobby-tier cron cap is 60s; Pro is 300s. Set the maxDuration high
// so a busy pass doesn't get killed mid-analysis.
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data: sources } = await admin
    .from("transcript_sources")
    .select("*")
    .eq("status", "active");

  const summary: Array<{
    sourceId: string;
    filesSeen: number;
    ingested: number;
    error?: string;
  }> = [];

  for (const source of (sources ?? []) as TranscriptSource[]) {
    const result = await ingestSource(source);
    summary.push({
      sourceId: source.id,
      filesSeen: result.filesSeen,
      ingested: result.filesIngested,
      error: result.error,
    });
  }

  // After ingest, process everything that's now pending across all
  // routed companies. A source-scoped analysis would miss cross-
  // company routing from shared folders.
  const analysis = await processPendingMeetings();

  return Response.json({
    sources: summary,
    analyzed: analysis.processed,
  });
}

// Same route accepts GET for Vercel's cron trigger (older projects
// dispatch cron as GET) — the bearer check still gates it.
export const GET = POST;
