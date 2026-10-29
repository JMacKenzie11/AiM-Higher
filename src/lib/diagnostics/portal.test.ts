import { describe, expect, it } from "vitest";
import { portalBanner, portalBot, portalTotals, sortPortalBots, type PortalBotData } from "./portal";

const now = new Date("2026-10-29T12:00:00Z"); // a Thursday; the week began Oct 26
const data = (over: Partial<PortalBotData> = {}): PortalBotData => ({
  automation: { id: "a1", title: "Invoice matching", stage: "live", goes_live: "2026-09-01" },
  bot: { kind: "scheduled", every: "day", every_hours: null, at_time: "07:00", trigger_text: null, safety_every: null, item_noun: "invoice", minutes_per_item: 5, hourly_rate: 45, currency: "CAD", agreed_on: "2026-08-29", created_at: "2026-09-01T00:00:00Z" },
  runs: [
    { ran_at: "2026-10-29T07:00:00Z", result: "worked", items: 24 },
    { ran_at: "2026-10-28T07:00:00Z", result: "failed", items: 0 },
    { ran_at: "2026-10-27T07:00:00Z", result: "worked", items: 12 },
    { ran_at: "2026-10-22T07:00:00Z", result: "worked", items: 36 },
  ],
  total_items_worked: 600,
  total_runs: 40,
  first_run_at: "2026-09-01T07:00:00Z",
  ...over,
});

describe("portalBot", () => {
  const b = portalBot(data(), now);

  it("counts this week's runs and hours, last week's hours, and the total from every run", () => {
    expect(b).toMatchObject({ runsThisWeek: 3, itemsThisWeek: 36, hoursThisWeek: 3, hoursLastWeek: 3, hoursTotal: 50, dollarsTotal: 2250, status: "running_well" });
  });

  it("draws the last runs oldest first, and eight weeks ending with this one", () => {
    expect(b.strip).toEqual(["worked", "worked", "failed", "worked"]);
    expect(b.weeks).toHaveLength(8);
    expect(b.weeks[7]).toEqual({ start: "2026-10-26", hours: 3 });
    expect(b.weeks[6]).toEqual({ start: "2026-10-19", hours: 3 });
    expect(b.recent[1]).toMatchObject({ result: "failed", minutes: 0 });
  });

  it("says needs attention when the last run failed, and never carries a reason", () => {
    const failed = portalBot(data({ runs: [{ ran_at: "2026-10-29T07:00:00Z", result: "failed", items: 0 }] }), now);
    expect(failed.status).toBe("needs_attention");
    expect(JSON.stringify(failed)).not.toMatch(/note/);
  });
});

describe("portalTotals and the banner", () => {
  const well = portalBot(data(), now);
  const late = { ...portalBot(data({ automation: { id: "a2", title: "Quote follow-ups", stage: "live", goes_live: "2026-08-04" } }), now), status: "late" as const };
  const stopped = { ...portalBot(data({ automation: { id: "a3", title: "Order entry", stage: "live", goes_live: null } }), now), status: "stopped" as const };

  it("adds hours and money across bots, names one rate, and finds the first go-live", () => {
    const t = portalTotals([well, late], ["2026-09-01T07:00:00Z"], ["2026-09-01", "2026-08-04"]);
    expect(t).toMatchObject({ hoursThisWeek: 6, hoursTotal: 100, dollarsTotal: 4500, currency: "CAD", rate: 45, firstLive: "2026-08-04" });
  });

  it("says nothing when every bot runs well, and names the others in plain words when not", () => {
    expect(portalBanner([well])).toBeNull();
    expect(portalBanner([well, late, stopped])).toEqual({
      tone: "bad",
      lead: "1 of 3 bots are running well.",
      detail: "Quote follow-ups is late and Order entry has stopped. We have been told and are looking at them.",
    });
  });

  it("lists the ones needing a look first", () => {
    expect(sortPortalBots([well, late, stopped]).map((b) => b.name)).toEqual(["Order entry", "Quote follow-ups", "Invoice matching"]);
  });
});
