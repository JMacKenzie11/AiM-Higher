import { describe, expect, it } from "vitest";
import { botHealth, botSavings, botSchedule, suggestBotCode, weekdayMs, weekStartUtc, type BotRun } from "./bots";

const live = { stage: "live", goes_live: "2026-10-01" };
const daily = { kind: "scheduled" as const, every: "day" as const, every_hours: null, safety_every: null, created_at: "2026-10-01T00:00:00Z" };
const run = (ran_at: string, result: "worked" | "failed" = "worked", items = 1, note: string | null = null): BotRun => ({ ran_at, result, items, note });

describe("botHealth", () => {
  const now = new Date("2026-10-29T12:00:00Z");

  it("is not live unless the automation is live, whatever its runs", () => {
    expect(botHealth(daily, { stage: "paused", goes_live: null }, [], now).status).toBe("not_live");
    expect(botHealth(daily, { stage: "testing", goes_live: null }, [run("2026-10-01T00:00:00Z", "failed")], now).status).toBe("not_live");
  });

  it("runs well inside an interval and a half, is late past it, and stopped past two and a half", () => {
    expect(botHealth(daily, live, [run("2026-10-28T08:00:00Z")], now).status).toBe("running_well"); // 28h
    expect(botHealth(daily, live, [run("2026-10-27T23:00:00Z")], now).status).toBe("late"); // 37h
    expect(botHealth(daily, live, [run("2026-10-26T23:00:00Z")], now)).toMatchObject({ status: "stopped", reason: "Missed two runs in a row" }); // 61h
  });

  it("needs attention when the last run failed, giving its reason, and counts failures in a row", () => {
    const h = botHealth(daily, live, [run("2026-10-29T07:00:00Z", "failed", 0, "CRM did not respond"), run("2026-10-28T07:00:00Z", "failed"), run("2026-10-27T07:00:00Z")], now);
    expect(h).toEqual({ status: "needs_attention", reason: "Failed 2 times in a row: CRM did not respond", failedInARow: 2 });
    expect(botHealth(daily, live, [run("2026-10-29T07:00:00Z", "failed")], now).reason).toBe("Last run failed");
  });

  it("calls a bot that failed and then went quiet stopped", () => {
    expect(botHealth(daily, live, [run("2026-10-26T00:00:00Z", "failed")], now).status).toBe("stopped");
  });

  it("starts the clock when the automation went live, before the first run", () => {
    expect(botHealth(daily, { stage: "live", goes_live: "2026-10-29" }, [], now).status).toBe("running_well");
    expect(botHealth(daily, { stage: "live", goes_live: "2026-10-20" }, [], now)).toMatchObject({ status: "stopped", reason: "No run reported since it went live" });
  });

  it("counts weekday time only for a weekday bot, so Friday's run is not late on Monday", () => {
    const weekday = { ...daily, every: "weekday" as const };
    const monday = new Date("2026-10-26T12:00:00Z");
    expect(botHealth(weekday, live, [run("2026-10-23T07:00:00Z")], monday).status).toBe("running_well");
  });

  it("never calls a triggered bot with no safety net late, and uses the safety net when there is one", () => {
    const triggered = { ...daily, kind: "triggered" as const, every: null };
    expect(botHealth(triggered, live, [run("2026-09-01T00:00:00Z")], now).status).toBe("running_well");
    expect(botHealth({ ...triggered, safety_every: "day" }, live, [run("2026-10-26T23:00:00Z")], now).status).toBe("stopped");
    expect(botHealth(triggered, live, [run("2026-10-29T00:00:00Z", "failed")], now).status).toBe("needs_attention");
  });

  it("uses every N hours for an hourly bot", () => {
    const fourHours = { ...daily, every: "hours" as const, every_hours: 4 };
    expect(botHealth(fourHours, live, [run("2026-10-29T08:30:00Z")], now).status).toBe("running_well"); // 3.5h
    expect(botHealth(fourHours, live, [run("2026-10-29T05:00:00Z")], now).status).toBe("late"); // 7h
  });
});

describe("weekdayMs", () => {
  it("skips Saturday and Sunday", () => {
    expect(weekdayMs(Date.parse("2026-10-23T12:00:00Z"), Date.parse("2026-10-26T12:00:00Z"))).toBe(24 * 3_600_000);
  });
});

describe("botSavings", () => {
  const bot = { minutes_per_item: 5, hourly_rate: 45 };
  const now = new Date("2026-10-29T12:00:00Z"); // a Thursday

  it("saves items times minutes for runs that worked, nothing for failed ones, and splits out this week", () => {
    const s = botSavings(bot, [run("2026-10-28T07:00:00Z", "worked", 24), run("2026-10-27T07:00:00Z", "failed", 0), run("2026-10-20T07:00:00Z", "worked", 12)], now);
    expect(s).toEqual({ runs: 3, runsThisWeek: 2, hoursThisWeek: 2, hoursTotal: 3, dollarsTotal: 135, dollarsThisWeek: 90 });
  });

  it("starts the week on Monday at midnight UTC", () => {
    expect(new Date(weekStartUtc(now)).toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });
});

describe("botSchedule", () => {
  it("says how a bot runs in words", () => {
    expect(botSchedule({ kind: "scheduled", every: "weekday", every_hours: null, at_time: "07:00", trigger_text: null })).toBe("Weekdays at 7:00 am");
    expect(botSchedule({ kind: "scheduled", every: "hours", every_hours: 4, at_time: null, trigger_text: null })).toBe("Every 4 hours");
    expect(botSchedule({ kind: "scheduled", every: "week", every_hours: null, at_time: "16:00", trigger_text: null })).toBe("Weekly at 4:00 pm");
    expect(botSchedule({ kind: "triggered", every: null, every_hours: null, at_time: null, trigger_text: "A new invoice arrives" })).toBe("When a new invoice arrives");
  });
});

describe("suggestBotCode", () => {
  it("joins the client's first word and the automation's title", () => {
    expect(suggestBotCode("Northline Fabrication", "Supplier invoice matching")).toBe("northline-supplier-invoice-matching");
    expect(suggestBotCode("Café Rouge", "Orders & quotes")).toBe("cafe-orders-quotes");
  });
});
