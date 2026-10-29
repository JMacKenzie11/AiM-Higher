import "server-only";

import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOT_COLUMNS, botHealth, botStatusLabel, type BotRow, type BotRun, type BotStatus } from "./bots";

// THE BOT ALERTS (0308). Jason, 2026-10-29: when a bot goes Late,
// Stopped or Needs attention, or comes back to Running well, AiMS HQ
// tells his own Bot Management Grok Bot by webhook. Run by the bot
// health cron every 15 minutes across every instance, and straight
// after a bot reports a run through the MCP server.
//
// THE SERVICE ROLE, and only here. A cron has no person to act as, so
// this reads the bots with the admin client it is handed and writes
// one thing: diagnostic_bots.alert_status and alert_status_at, the
// status the webhook was last told. Nothing else in the module writes
// as the service role.
//
// THE WEBHOOK. POST to BOT_ALERT_WEBHOOK_URL, JSON, signed with
// BOT_ALERT_WEBHOOK_SECRET: X-AiMS-Timestamp is the Unix time in
// seconds, and X-AiMS-Signature is "sha256=" + the hex HMAC-SHA256 of
// "<timestamp>.<body>". A receiver recomputes it and refuses a stale
// timestamp. A send that fails leaves alert_status as it was, so the
// next check tries again. With no URL set, statuses are recorded and
// nothing is sent.

const PROBLEMS: BotStatus[] = ["late", "stopped", "needs_attention"];

export type BotAlert = {
  event: "bot.status_changed";
  bot: { code: string; automation: string; client: string };
  status: BotStatus;
  status_label: string;
  previous_status: BotStatus | null;
  reason: string | null;
  last_run_at: string | null;
  at: string;
};

// Whether a change is worth a message: into a problem, between
// problems, or back to running well from one. Going live or pausing is
// recorded quietly.
export function alertWorthy(previous: BotStatus | null, next: BotStatus): boolean {
  if (previous === next) return false;
  if (PROBLEMS.includes(next)) return true;
  return next === "running_well" && previous !== null && PROBLEMS.includes(previous);
}

export function signAlert(body: string, secret: string, timestamp: number): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

async function sendAlert(alert: BotAlert): Promise<"sent" | "not_configured" | "failed"> {
  const url = process.env.BOT_ALERT_WEBHOOK_URL;
  const secret = process.env.BOT_ALERT_WEBHOOK_SECRET;
  if (!url || !secret) return "not_configured";
  const body = JSON.stringify(alert);
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aims-timestamp": String(timestamp),
        "x-aims-signature": signAlert(body, secret, timestamp),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

type Loaded = BotRow & {
  diagnostic_automations: { title: string; stage: string; goes_live: string | null } | null;
  diagnostic_clients: { name: string; archived_at: string | null } | null;
};

export type BotCheckSummary = { checked: number; changed: number; sent: number; failed: number; notConfigured: boolean };

// Checks every bot (or one), records each status change, and sends a
// webhook for the ones worth one.
export async function checkBots(admin: SupabaseClient, opts: { botId?: string; now?: Date } = {}): Promise<BotCheckSummary> {
  const now = opts.now ?? new Date();
  let q = admin
    .from("diagnostic_bots")
    .select(`${BOT_COLUMNS}, diagnostic_automations(title, stage, goes_live), diagnostic_clients(name, archived_at)`)
    .limit(2000);
  if (opts.botId) q = q.eq("id", opts.botId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const bots = ((data ?? []) as unknown as Loaded[]).filter((b) => b.diagnostic_automations && b.diagnostic_clients && !b.diagnostic_clients.archived_at);
  const summary: BotCheckSummary = { checked: bots.length, changed: 0, sent: 0, failed: 0, notConfigured: false };

  for (const bot of bots) {
    const { data: runRows } = await admin
      .from("diagnostic_bot_runs")
      .select("ran_at, result, items, note")
      .eq("bot_id", bot.id)
      .order("ran_at", { ascending: false })
      .limit(20);
    const runs = (runRows ?? []) as BotRun[];
    const health = botHealth(bot, bot.diagnostic_automations!, runs, now);
    if (health.status === bot.alert_status) continue;
    summary.changed++;

    if (alertWorthy(bot.alert_status, health.status)) {
      const outcome = await sendAlert({
        event: "bot.status_changed",
        bot: { code: bot.code, automation: bot.diagnostic_automations!.title, client: bot.diagnostic_clients!.name },
        status: health.status,
        status_label: botStatusLabel(health.status),
        previous_status: bot.alert_status,
        reason: health.reason,
        last_run_at: runs[0]?.ran_at ?? null,
        at: now.toISOString(),
      });
      if (outcome === "failed") {
        summary.failed++;
        continue;
      }
      if (outcome === "sent") summary.sent++;
      else summary.notConfigured = true;
    }
    await admin.from("diagnostic_bots").update({ alert_status: health.status, alert_status_at: now.toISOString() }).eq("id", bot.id);
  }
  return summary;
}
