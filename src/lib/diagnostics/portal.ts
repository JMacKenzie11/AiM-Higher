import { botHealth, botSchedule, botStatusLabel, weekStartUtc, type BotRow, type BotRun, type BotStatus } from "./bots";
import type { AutomationRow } from "./types";

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

// WHERE THE PROJECT STANDS (0311; Jason, 2026-10-30, the approved
// mockup). Shown until the first automation goes live: the four
// stages, the current one, a date for each, and one sentence on what
// is happening now. Everything comes from what the lead already
// enters: the diagnostic's status and dates, and the automations'
// stages and dates. Nothing is typed for it.

export type PortalDiagnostic = { status: string; kickoff_at: string | null; readout_at: string | null; published_at: string | null };

export type ProjectStepKey = "diagnostic" | "readout" | "building" | "running";
export type ProjectStep = { key: ProjectStepKey; title: string; about: string; state: "done" | "current" | "todo"; when: string };
export type PortalProject = {
  steps: ProjectStep[];
  at: number;
  now: string;
  // The automation nearest to going live, for the bots placeholder.
  next: { title: string; goesLive: string | null } | null;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d, w: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};
// "October 20"
export const monthDay = (iso: string) => {
  const { m, d } = day(iso);
  return `${MONTHS[m - 1]} ${d}`;
};
// "Friday, November 14"
export const weekdayDate = (iso: string) => `${DAYS[day(iso).w]}, ${monthDay(iso)}`;

const STAGE_ORDER: Record<string, number> = { testing: 0, building: 1, planned: 2 };

export function portalProject(
  dx: PortalDiagnostic | null,
  automations: Array<Pick<AutomationRow, "title" | "stage" | "build_starts" | "goes_live">>,
  today: string
): PortalProject | null {
  if (automations.some((a) => a.stage === "live")) return null;
  const active = automations
    .filter((a) => a.stage in STAGE_ORDER)
    .sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || (a.goes_live ?? "9999").localeCompare(b.goes_live ?? "9999"));
  const published = Boolean(dx?.published_at);
  const started = active.some((a) => a.stage !== "planned");
  const at = published || started ? 2 : dx?.status === "readout" ? 1 : 0;
  const state = (i: number) => (i < at ? "done" : i === at ? "current" : "todo") as ProjectStep["state"];
  const nearest = active[0] ?? null;
  const firstLive = active.map((a) => a.goes_live).filter((x): x is string => Boolean(x)).sort()[0] ?? null;
  const kickoff = dx?.kickoff_at ?? null;

  const steps: ProjectStep[] = [
    {
      key: "diagnostic",
      title: "Capacity Diagnostic",
      about: "We map your systems and find where the hours go.",
      state: state(0),
      when: kickoff ? `${kickoff <= today ? "Started" : "Starts"} ${monthDay(kickoff)}` : "Starting soon",
    },
    {
      key: "readout",
      title: "Your readout",
      about: "What we found, your first win and a 90-day plan.",
      state: state(1),
      when: dx?.published_at ? `Published ${monthDay(dx.published_at)}` : dx?.readout_at ? `Booked for ${monthDay(dx.readout_at)}` : "Date to come",
    },
    {
      key: "building",
      // Deployment and Support, as the proposal names the stages (0312).
      title: "Deployment",
      about: "We build and launch your bots and test them with you.",
      state: state(2),
      when: at === 2 && active.length ? `${active.length} ${active.length === 1 ? "automation" : "automations"} in progress` : "After your readout",
    },
    {
      key: "running",
      title: "Support",
      about: "Your bots do the work and we watch every run. You see the hours they save here.",
      state: state(3),
      when: firstLive ? `First one goes live ${monthDay(firstLive)}` : "After deployment",
    },
  ];

  let now: string;
  if (at === 0) {
    now = "We are mapping your systems and the tasks that take up your team's week.";
    if (dx?.readout_at && dx.readout_at >= today) now += ` Your readout is on ${weekdayDate(dx.readout_at)}.`;
  } else if (at === 1) {
    now = "We are putting your readout together.";
    if (dx?.readout_at && dx.readout_at >= today) now += ` It is on ${weekdayDate(dx.readout_at)}.`;
  } else if (nearest) {
    now =
      nearest.stage === "testing"
        ? `${nearest.title} is being tested with your team.`
        : nearest.stage === "building"
          ? `${nearest.title} is being built.`
          : `${nearest.title} is planned.`;
    if (nearest.goes_live && nearest.goes_live >= today) now += ` It goes live on ${weekdayDate(nearest.goes_live)}.`;
    else if (nearest.stage === "planned" && nearest.build_starts && nearest.build_starts >= today) now += ` Building starts on ${weekdayDate(nearest.build_starts)}.`;
  } else {
    now = "Your readout is ready. Your first automations are being planned.";
  }

  return { steps, at, now, next: nearest ? { title: nearest.title, goesLive: nearest.goes_live } : null };
}
