import "server-only";

import { NextRequest } from "next/server";
import { checkBots } from "@/lib/diagnostics/bot-alerts";
import { forEachActiveInstance } from "@/lib/instances/for-each";

// Every 15 minutes: is each Capacity Diagnostic bot keeping to its
// schedule (0308)? Records each bot's status and sends the webhook to
// Jason's Bot Management Grok Bot when one goes Late, Stopped or Needs
// attention, or recovers (lib/diagnostics/bot-alerts.ts).
//
// Runs against every active instance. Bots live on HQ alone (0295), so
// elsewhere it finds none and says so.
//
// Auth: standard CRON_SECRET bearer. Vercel cron entry in vercel.json.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

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
    job: "bot-health",
    run: ({ admin }) => checkBots(admin),
    line: (r) =>
      `${r.checked} bots checked, ${r.changed} changed, ${r.sent} alerts sent, ${r.failed} failed` +
      (r.notConfigured ? ", webhook not configured" : ""),
  });

  return Response.json(summary, { status: summary.ok ? 200 : 500 });
}
