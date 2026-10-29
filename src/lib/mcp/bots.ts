import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { checkBots } from "@/lib/diagnostics/bot-alerts";
import { botHealth, botSavings, botSchedule, botStatusLabel, type BotRow, type BotRun } from "@/lib/diagnostics/bots";
import { AddRefused } from "./adds";
import { ReadFailed } from "./reads";

// THE BOT TOOLS (0308). Jason, 2026-10-29: the Capacity Diagnostic's
// bots, mostly Grok Bots, report each run to AiMS HQ here, signed in as
// a system admin, and name themselves by bot code; his Bot Management
// Grok Bot lists them, or only the ones with a problem.
//
// Both go through a database function on the assistant's token, as the
// person: assistant_record_bot_run() and assistant_bots(), which refuse
// anyone but a system admin on HQ. The tables themselves stay closed to
// an assistant (0270). After a run is recorded, the bot's status is
// checked at once, so a failure reaches the webhook without waiting for
// the 15-minute check.

type Ctx = { db: SupabaseClient };

function refusedOr(error: { code?: string; message?: string; hint?: string }): never {
  if (error.code === "42501") throw new AddRefused("Only a system admin on AiMS HQ can report or list bots.", "not_system_admin");
  if (error.code === "P0002") throw new AddRefused(error.hint ? `${error.message ?? "No bot has that code."} ${error.hint}` : "No bot has that code.", "bot_unknown");
  if (error.code === "22023") throw new AddRefused("Result is worked or failed, and items is a whole number.", "bad_input");
  throw new ReadFailed(error.code ?? "unknown");
}

export async function recordBotRun(
  { db }: Ctx,
  args: { bot: string; result: "worked" | "failed"; items?: number; note?: string }
): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("assistant_record_bot_run", {
    p_code: args.bot,
    p_result: args.result,
    p_items: args.items ?? null,
    p_note: args.note ?? null,
  });
  if (error) refusedOr(error);
  const run = data as { bot_id: string; bot: string; automation: string; client: string; result: string; items: number };
  // The alert check, as the service role (lib/diagnostics/bot-alerts.ts).
  // A failure here does not undo the run, which is recorded.
  try {
    await checkBots(await createSupabaseAdminClient(getCurrentInstanceConfig()), { botId: run.bot_id });
  } catch (e) {
    console.warn("bot alert check after a run failed", { bot: run.bot, message: e instanceof Error ? e.message : String(e) });
  }
  return {
    recorded: true,
    bot: run.bot,
    automation: run.automation,
    client: run.client,
    result: run.result,
    items_counted: run.items,
  };
}

type Listed = {
  bot: BotRow;
  automation: { title: string; stage: string; goes_live: string | null };
  client: string;
  runs: BotRun[];
};

export async function listBots({ db }: Ctx, args: { problems_only?: boolean }): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("assistant_bots");
  if (error) refusedOr(error);
  const now = new Date();
  const bots = ((data ?? []) as Listed[]).map((b) => {
    const health = botHealth(b.bot, b.automation, b.runs, now);
    const savings = botSavings(b.bot, b.runs, now);
    return {
      bot: b.bot.code,
      automation: b.automation.title,
      client: b.client,
      schedule: botSchedule(b.bot),
      status: botStatusLabel(health.status),
      why: health.reason,
      last_run_at: b.runs[0]?.ran_at ?? null,
      last_result: b.runs[0]?.result ?? null,
      runs_this_week: savings.runsThisWeek,
      hours_saved_this_week: Math.round(savings.hoursThisWeek * 10) / 10,
      problem: health.status === "late" || health.status === "stopped" || health.status === "needs_attention",
    };
  });
  const shown = args.problems_only ? bots.filter((b) => b.problem) : bots;
  return { bots: shown.map(({ problem: _problem, ...b }) => b) };
}
