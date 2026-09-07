import "server-only";

import { NextRequest } from "next/server";
import { ingestSource, processPendingMeetings } from "@/lib/transcripts/ingest";
import type { TranscriptSource } from "@/lib/types";
import { forEachActiveInstance } from "@/lib/instances/for-each";

// Vercel Cron target — configured in vercel.json to run every 15 min.
// Authenticated with a bearer token so a random public request can't
// trigger the ingestion + analysis pipeline (which spends money and
// sends emails).
//
// Runs against every active instance, not just the primary. The body
// of the work is unchanged: what one instance gets here is exactly
// what the only instance got before. Note that ingestSource and
// processPendingMeetings still build their own admin clients rather
// than taking the one the helper hands us. That is deliberate and it
// is correct: they resolve through getCurrentInstanceConfig(), which
// answers from the instance scope the helper opened. See
// src/lib/instances/context.ts for why threading a client through
// that pipeline instead would have been the more dangerous option.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The Anthropic + Drive round-trips per source can add up, and there
// are now several instances' worth of them in one invocation.
// Vercel's hobby-tier cron cap is 60s; Pro is 300s. Set the
// maxDuration high so a busy pass doesn't get killed mid-analysis.
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

  const summary = await forEachActiveInstance({
    job: "transcripts",
    run: async ({ admin }) => {
      const { data: sources } = await admin
        .from("transcript_sources")
        .select("*")
        .eq("status", "active");

      const perSource: Array<{
        sourceId: string;
        filesSeen: number;
        ingested: number;
        error?: string;
      }> = [];

      for (const source of (sources ?? []) as TranscriptSource[]) {
        const result = await ingestSource(source);
        perSource.push({
          sourceId: source.id,
          filesSeen: result.filesSeen,
          ingested: result.filesIngested,
          error: result.error,
        });
      }

      // After ingest, process everything that's now pending across
      // all routed companies. A source-scoped analysis would miss
      // cross-company routing from shared folders.
      const analysis = await processPendingMeetings();

      return {
        sources: perSource,
        ingested: perSource.reduce((n, s) => n + s.ingested, 0),
        analyzed: analysis.processed,
      };
    },
    line: (r) =>
      `checked ${r.sources.length} sources, ingested ${r.ingested}, ` +
      `analyzed ${r.analyzed}`,
  });

  // Any instance failing makes the whole run red, so it shows in
  // Vercel's cron history rather than being buried in a 200 body.
  return Response.json(summary, { status: summary.ok ? 200 : 500 });
}

// Same route accepts GET for Vercel's cron trigger (older projects
// dispatch cron as GET) — the bearer check still gates it.
export const GET = POST;
