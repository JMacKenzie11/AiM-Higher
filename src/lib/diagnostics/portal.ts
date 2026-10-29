import { botHealth, botSchedule, botStatusLabel, weekStartUtc, type BotRow, type BotRun, type BotStatus } from "./bots";

// THE CLIENT DASHBOARD'S FIGURES (0310; Jason, 2026-10-29, the approved
// portal mockup). From what portal_dashboard() returns: each bot's
// status, this week's runs and hours, its hours in total and the last
// eight weeks, and the totals and the banner across them. Pure; the
// health rules are bots.ts's, so the client sees the status the alerts
// and the Bots page see. Never a failure's reason: the function does
// not return one.

const WEEK = 7 * 24 * 3_600_000;

export type PortalBotData = {
  automation: { id: string; title: string; stage: string; goes_live: string | null };
  bot: Pick<BotRow, "kind" | "every" | "every_hours" | "at_time" | "trigger_text" | "safety_every" | "item_noun" | "minutes_per_item" | "hourly_rate" | "currency" | "agreed_on" | "created_at">;
  runs: Array<Pick<BotRun, "ran_at" | "result" | "items">>;
  total_items_worked: number;
  total_runs: number;
  first_run_at: string | null;
};

export type PortalBot = {
  id: string;
  name: string;
  status: BotStatus;
  statusLabel: string;
  schedule: string;
  expectation: string;
  lastRunAt: string | null;
  runsThisWeek: number;
  itemsThisWeek: number;
  hoursThisWeek: number;
  hoursLastWeek: number;
  hoursTotal: number;
  dollarsTotal: number;
  dollarsThisWeek: number;
  currency: "CAD" | "USD";
  itemNoun: string;
  minutesPerItem: number;
  hourlyRate: number;
  agreedOn: string | null;
  // Newest last: the last fourteen runs, worked or failed.
  strip: Array<"worked" | "failed">;
  // Oldest first: hours saved in each of the last eight weeks, this one
  // last, with the Monday it began.
  weeks: Array<{ start: string; hours: number }>;
  recent: Array<{ ranAt: string; result: "worked" | "failed"; items: number; minutes: number }>;
};

const hoursOf = (items: number, minutes: number) => (items * minutes) / 60;

export function portalBot(d: PortalBotData, now: Date): PortalBot {
  const minutes = Number(d.bot.minutes_per_item) || 0;
  const rate = Number(d.bot.hourly_rate) || 0;
  const runs = d.runs as BotRun[];
  const health = botHealth({ ...d.bot }, d.automation, runs.map((r) => ({ ...r, note: null })), now);
  const week = weekStartUtc(now);
  const inWeek = (r: { ran_at: string }, start: number) => {
    const t = Date.parse(r.ran_at);
    return t >= start && t < start + WEEK;
  };
  const worked = (start: number) => runs.filter((r) => r.result === "worked" && inWeek(r, start)).reduce((n, r) => n + r.items, 0);
  const itemsThisWeek = worked(week);
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = week - (7 - i) * WEEK;
    return { start: new Date(start).toISOString().slice(0, 10), hours: hoursOf(worked(start), minutes) };
  });
  const hoursTotal = hoursOf(Number(d.total_items_worked) || 0, minutes);
  const every = d.bot.kind === "scheduled" ? d.bot.every : d.bot.safety_every;
  return {
    id: d.automation.id,
    name: d.automation.title,
    status: health.status,
    statusLabel: botStatusLabel(health.status),
    schedule: botSchedule(d.bot),
    expectation: every
      ? "Late once a run is half an interval overdue. Stopped after two missed runs."
      : "Runs when it is needed, so there is no schedule to be late for.",
    lastRunAt: runs[0]?.ran_at ?? null,
    runsThisWeek: runs.filter((r) => inWeek(r, week)).length,
    itemsThisWeek,
    hoursThisWeek: hoursOf(itemsThisWeek, minutes),
    hoursLastWeek: hoursOf(worked(week - WEEK), minutes),
    hoursTotal,
    dollarsTotal: hoursTotal * rate,
    dollarsThisWeek: hoursOf(itemsThisWeek, minutes) * rate,
    currency: d.bot.currency,
    itemNoun: d.bot.item_noun,
    minutesPerItem: minutes,
    hourlyRate: rate,
    agreedOn: d.bot.agreed_on,
    strip: runs.slice(0, 14).map((r) => r.result).reverse(),
    weeks,
    recent: runs.slice(0, 8).map((r) => ({ ranAt: r.ran_at, result: r.result, items: r.items, minutes: r.result === "worked" ? r.items * minutes : 0 })),
  };
}

export type PortalTotals = {
  hoursThisWeek: number;
  hoursLastWeek: number;
  hoursTotal: number;
  dollarsTotal: number;
  // The currency most of the money is in; a client's bots share one.
  currency: "CAD" | "USD";
  rate: number | null;
  firstLive: string | null;
};

export function portalTotals(bots: PortalBot[], firstRuns: Array<string | null>, goLives: Array<string | null>): PortalTotals {
  const byCurrency = new Map<string, number>();
  for (const b of bots) byCurrency.set(b.currency, (byCurrency.get(b.currency) ?? 0) + b.dollarsTotal);
  const currency = ([...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "CAD") as "CAD" | "USD";
  const rates = [...new Set(bots.map((b) => b.hourlyRate).filter((r) => r > 0))];
  const firsts = [...firstRuns, ...goLives].filter((x): x is string => Boolean(x)).map((x) => x.slice(0, 10)).sort();
  return {
    hoursThisWeek: bots.reduce((n, b) => n + b.hoursThisWeek, 0),
    hoursLastWeek: bots.reduce((n, b) => n + b.hoursLastWeek, 0),
    hoursTotal: bots.reduce((n, b) => n + b.hoursTotal, 0),
    dollarsTotal: bots.filter((b) => b.currency === currency).reduce((n, b) => n + b.dollarsTotal, 0),
    currency,
    rate: rates.length === 1 ? rates[0] : null,
    firstLive: firsts[0] ?? null,
  };
}

const PROBLEM_WORDS: Partial<Record<BotStatus, string>> = { late: "is late", stopped: "has stopped", needs_attention: "needs attention" };

// The line over the bots: how many are running well, and in plain words
// which are not. Null when every live bot is running well.
export function portalBanner(bots: PortalBot[]): { tone: "warn" | "bad"; lead: string; detail: string } | null {
  const live = bots.filter((b) => b.status !== "not_live");
  const problems = live.filter((b) => PROBLEM_WORDS[b.status]);
  if (problems.length === 0) return null;
  const well = live.filter((b) => b.status === "running_well").length;
  const names = problems.map((b) => `${b.name} ${PROBLEM_WORDS[b.status]}`);
  const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return {
    tone: problems.some((b) => b.status === "stopped") ? "bad" : "warn",
    lead: `${well} of ${live.length} ${live.length === 1 ? "bot is" : "bots are"} running well.`,
    detail: `${listed.charAt(0).toUpperCase()}${listed.slice(1)}. We have been told and are looking at ${problems.length === 1 ? "it" : "them"}.`,
  };
}

// Live first, then the ones needing a look, then by name.
export function sortPortalBots(bots: PortalBot[]): PortalBot[] {
  const order: Record<BotStatus, number> = { stopped: 0, needs_attention: 1, late: 2, running_well: 3, not_live: 4 };
  return [...bots].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

// The four stages a client's automation moves through, for the stepper.
export const BUILD_STEPS = ["planned", "building", "testing", "live"] as const;
