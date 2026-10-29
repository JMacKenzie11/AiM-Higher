// A client's bots (0308): whether each is keeping to its schedule, and
// what it has saved. Pure, so the pages, the alert check and the MCP
// list tools all say the same thing.
//
// THE RULES (Jason, 2026-10-29).
//   Not live     the automation is not at the Live stage, so nothing is
//                expected of the bot yet (or it is paused).
//   Stopped      no run for two of its intervals and a half: it has
//                missed two runs in a row.
//   Needs        its last run failed. Stopped outranks it: a bot that
//   attention    failed and then went quiet is Stopped.
//   Late         no run for an interval and a half: its next run is
//                half an interval overdue.
//   Running well otherwise.
// The interval is the schedule's, or a triggered bot's safety net. A
// triggered bot with no safety net is never Late or Stopped, since
// nobody knows when it should run. A weekday interval counts weekday
// time only, so a Friday run is not late on Monday morning. Until the
// first run, the clock starts when the automation went live (or when
// the bot was added, if later).
//
// SAVINGS. A run that worked saves its items times the agreed minutes
// per item; a failed run saves nothing. Dollars are hours times the
// agreed hourly rate, in the bot's currency. "This week" is from Monday
// 00:00 UTC.

export type BotKind = "scheduled" | "triggered";
export type BotEvery = "hours" | "day" | "weekday" | "week" | "month";
export type SafetyEvery = "day" | "weekday" | "week";
export type BotStatus = "running_well" | "late" | "stopped" | "needs_attention" | "not_live";

export type BotRow = {
  id: string;
  automation_id: string;
  client_id: string;
  code: string;
  kind: BotKind;
  every: BotEvery | null;
  every_hours: number | null;
  at_time: string | null;
  trigger_text: string | null;
  safety_every: SafetyEvery | null;
  item_noun: string;
  minutes_per_item: number;
  hourly_rate: number;
  currency: "CAD" | "USD";
  agreed_on: string | null;
  alert_status: BotStatus | null;
  alert_status_at: string | null;
  created_at: string;
};

export const BOT_COLUMNS =
  "id, automation_id, client_id, code, kind, every, every_hours, at_time, trigger_text, safety_every, item_noun, minutes_per_item, hourly_rate, currency, agreed_on, alert_status, alert_status_at, created_at";

export type BotRun = { ran_at: string; result: "worked" | "failed"; items: number; note: string | null };

export const BOT_STATUSES: Array<{ value: BotStatus; label: string }> = [
  { value: "running_well", label: "Running well" },
  { value: "late", label: "Late" },
  { value: "stopped", label: "Stopped" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "not_live", label: "Not live yet" },
];

export function botStatusLabel(s: BotStatus): string {
  return BOT_STATUSES.find((x) => x.value === s)?.label ?? s;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// The interval, in milliseconds of counted time (weekday time for a
// weekday interval), or null when nothing says how often it should run.
export function botInterval(bot: Pick<BotRow, "kind" | "every" | "every_hours" | "safety_every">): { ms: number; weekdays: boolean } | null {
  const every = bot.kind === "scheduled" ? bot.every : bot.safety_every;
  switch (every) {
    case "hours":
      return { ms: Math.max(1, bot.every_hours ?? 1) * HOUR, weekdays: false };
    case "day":
      return { ms: DAY, weekdays: false };
    case "weekday":
      return { ms: DAY, weekdays: true };
    case "week":
      return { ms: 7 * DAY, weekdays: false };
    case "month":
      return { ms: 31 * DAY, weekdays: false };
    default:
      return null;
  }
}

// Milliseconds between two instants counting only Monday to Friday
// (UTC).
export function weekdayMs(fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;
  let total = 0;
  let t = fromMs;
  while (t < toMs) {
    const d = new Date(t);
    const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    const end = Math.min(nextMidnight, toMs);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) total += end - t;
    t = end;
  }
  return total;
}

export type BotHealth = { status: BotStatus; reason: string | null; failedInARow: number };

const plural = (n: number, one: string) => (n === 1 ? `${one}` : `${n} times`);

// runs: newest first.
export function botHealth(
  bot: Pick<BotRow, "kind" | "every" | "every_hours" | "safety_every" | "created_at">,
  automation: { stage: string; goes_live: string | null },
  runs: BotRun[],
  now: Date
): BotHealth {
  let failedInARow = 0;
  for (const r of runs) {
    if (r.result !== "failed") break;
    failedInARow++;
  }
  if (automation.stage !== "live") return { status: "not_live", reason: null, failedInARow };

  const interval = botInterval(bot);
  if (interval) {
    const liveFrom = automation.goes_live ? Date.parse(`${automation.goes_live}T00:00:00Z`) : 0;
    const since = runs[0] ? Date.parse(runs[0].ran_at) : Math.max(liveFrom, Date.parse(bot.created_at));
    const quiet = interval.weekdays ? weekdayMs(since, now.getTime()) : now.getTime() - since;
    if (quiet > 2.5 * interval.ms) {
      return { status: "stopped", reason: runs[0] ? "Missed two runs in a row" : "No run reported since it went live", failedInARow };
    }
    if (failedInARow > 0) {
      return { status: "needs_attention", reason: failedReason(runs[0], failedInARow), failedInARow };
    }
    if (quiet > 1.5 * interval.ms) return { status: "late", reason: "Its next run is overdue", failedInARow };
    return { status: "running_well", reason: null, failedInARow };
  }
  if (failedInARow > 0) return { status: "needs_attention", reason: failedReason(runs[0], failedInARow), failedInARow };
  return { status: "running_well", reason: null, failedInARow };
}

function failedReason(last: BotRun, inARow: number): string {
  const head = inARow === 1 ? "Last run failed" : `Failed ${plural(inARow, "once")} in a row`;
  return last.note ? `${head}: ${last.note}` : head;
}

// Monday 00:00 UTC of the week holding `now`.
export function weekStartUtc(now: Date): number {
  const dow = (now.getUTCDay() + 6) % 7;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow);
}

export type BotSavings = { runs: number; runsThisWeek: number; hoursThisWeek: number; hoursTotal: number; dollarsTotal: number; dollarsThisWeek: number };

export function botSavings(bot: Pick<BotRow, "minutes_per_item" | "hourly_rate">, runs: BotRun[], now: Date): BotSavings {
  const week = weekStartUtc(now);
  const minutes = Number(bot.minutes_per_item) || 0;
  const rate = Number(bot.hourly_rate) || 0;
  let hoursTotal = 0;
  let hoursThisWeek = 0;
  let runsThisWeek = 0;
  for (const r of runs) {
    const thisWeek = Date.parse(r.ran_at) >= week;
    if (thisWeek) runsThisWeek++;
    if (r.result !== "worked") continue;
    const h = (r.items * minutes) / 60;
    hoursTotal += h;
    if (thisWeek) hoursThisWeek += h;
  }
  return { runs: runs.length, runsThisWeek, hoursThisWeek, hoursTotal, dollarsTotal: hoursTotal * rate, dollarsThisWeek: hoursThisWeek * rate };
}

// "Weekdays at 7:00 am", "Every 4 hours", "When a new invoice arrives".
export function botSchedule(bot: Pick<BotRow, "kind" | "every" | "every_hours" | "at_time" | "trigger_text">): string {
  if (bot.kind === "triggered") return bot.trigger_text ? `When ${lowerFirst(bot.trigger_text)}` : "When something happens";
  const at = bot.at_time ? ` at ${clock(bot.at_time)}` : "";
  switch (bot.every) {
    case "hours":
      return bot.every_hours === 1 ? "Every hour" : `Every ${bot.every_hours} hours`;
    case "day":
      return `Daily${at}`;
    case "weekday":
      return `Weekdays${at}`;
    case "week":
      return `Weekly${at}`;
    case "month":
      return `Monthly${at}`;
    default:
      return "Not set";
  }
}

// "A new invoice arrives" reads on after "When"; "CRM sync" keeps its capitals.
const lowerFirst = (s: string) => (/^[A-Z](?:[a-z]|\s)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

// A bot code from a client and an automation: "Northline Fabrication",
// "Supplier invoice matching" → "northline-supplier-invoice-matching".
export function suggestBotCode(clientName: string, title: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const first = slug(clientName).split("-")[0] ?? "";
  return [first, slug(title)].filter(Boolean).join("-").slice(0, 60).replace(/-+$/, "");
}

export const BOT_CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
