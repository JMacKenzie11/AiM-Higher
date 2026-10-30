import { describe, expect, it } from "vitest";
import { portalBanner, portalBot, portalProject, portalTotals, sortPortalBots, type PortalBotData } from "./portal";

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

describe("portalProject", () => {
  const dx = { status: "preflight", kickoff_at: "2026-10-20", readout_at: "2026-11-13", published_at: null };
  const auto = (title: string, stage: string, goes_live: string | null = null, build_starts: string | null = null) =>
    ({ title, stage, goes_live, build_starts }) as Parameters<typeof portalProject>[1][number];

  it("during the diagnostic: step one, its kickoff, the booked readout, and the readout day in the sentence", () => {
    const p = portalProject(dx, [], "2026-10-30")!;
    expect(p.at).toBe(0);
    expect(p.steps.map((s) => s.state)).toEqual(["current", "todo", "todo", "todo"]);
    expect(p.steps[0].when).toBe("Started October 20");
    expect(p.steps[1].when).toBe("Booked for November 13");
    expect(p.now).toBe("We are mapping your systems and the tasks that take up your team's week. Your readout is on Friday, November 13.");
  });

  it("a readout in progress is step two", () => {
    const p = portalProject({ ...dx, status: "readout" }, [], "2026-11-10")!;
    expect(p.at).toBe(1);
    expect(p.now).toBe("We are putting your readout together. It is on Friday, November 13.");
  });

  it("once published, building: the automation nearest to live leads the sentence and the first go-live date shows", () => {
    const p = portalProject({ ...dx, status: "decided", published_at: "2026-11-14T15:00:00Z" }, [
      auto("New client intake", "planned", null, "2026-12-01"),
      auto("Invoice follow-ups", "testing", "2026-12-04"),
    ], "2026-11-28")!;
    expect(p.at).toBe(2);
    expect(p.steps.map((s) => s.state)).toEqual(["done", "done", "current", "todo"]);
    expect(p.steps[1].when).toBe("Published November 14");
    expect(p.steps[2].when).toBe("2 automations in progress");
    expect(p.steps[3].when).toBe("First one goes live December 4");
    expect(p.now).toBe("Invoice follow-ups is being tested with your team. It goes live on Friday, December 4.");
    expect(p.next).toEqual({ title: "Invoice follow-ups", goesLive: "2026-12-04" });
  });

  it("published with nothing planned yet says so, and a past date is left out", () => {
    expect(portalProject({ ...dx, published_at: "2026-11-14T15:00:00Z" }, [], "2026-11-20")!.now).toBe(
      "Your readout is ready. Your first automations are being planned."
    );
    expect(portalProject(dx, [], "2026-11-20")!.now).toBe("We are mapping your systems and the tasks that take up your team's week.");
  });

  it("with no diagnostic it still shows, and once anything is live it gives way to the dashboard", () => {
    expect(portalProject(null, [], "2026-10-30")!.steps[0].when).toBe("Starting soon");
    expect(portalProject(dx, [auto("Invoice follow-ups", "live")], "2026-10-30")).toBeNull();
  });
});
