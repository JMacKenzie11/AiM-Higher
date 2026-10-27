import { describe, it, expect } from "vitest";
import { activityItem, dayLabel, groupByDay, initials, startOfTodayIso } from "./activity";
import type { WorkerRun } from "@/lib/workers/types";

const run = (over: Partial<WorkerRun>): WorkerRun => ({
  id: "r1",
  worker_id: "w1",
  task: "Find shoes",
  status: "running",
  browser_session_id: null,
  result: null,
  error: null,
  step_count: 0,
  input_tokens: 0,
  output_tokens: 0,
  cost_usd_cents: 0,
  last_url: null,
  pending: null,
  asked_at: null,
  started_at: "2026-10-27T13:00:00Z",
  finished_at: null,
  created_at: "2026-10-27T12:59:00Z",
  ...over,
});

describe("activityItem", () => {
  it("shows the latest step while it works", () => {
    expect(activityItem(run({}), "Shoe checker", "Opened holabirdsports.com").detail).toBe("Opened holabirdsports.com");
    expect(activityItem(run({ status: "queued", started_at: null }), "Shoe checker", null)).toMatchObject({ event: "Started", detail: "Getting started" });
  });

  it("shows the first real line of the reply once done, skipping table rules", () => {
    const item = activityItem(run({ status: "done", finished_at: "2026-10-27T13:02:00Z", result: "\n|---|---|\nHere are the first 3 results.\n| a | b |" }), "Shoe checker", null);
    expect(item).toMatchObject({ event: "Finished", detail: "Here are the first 3 results.", at: "2026-10-27T13:02:00Z" });
  });

  it("says why it stopped", () => {
    expect(activityItem(run({ status: "failed", error: "Browserbase 402 on /sessions" }), "x", null).detail).toBe("Browserbase 402 on /sessions");
    expect(activityItem(run({ status: "stopped" }), "x", null).detail).toBe("You stopped it.");
  });
});

describe("days", () => {
  const now = new Date("2026-10-27T15:00:00Z");

  it("labels today, yesterday and older days in Toronto time", () => {
    expect(dayLabel("2026-10-27T05:00:00Z", now)).toBe("Today");
    // 02:00 UTC on the 27th is still the 26th in Toronto.
    expect(dayLabel("2026-10-27T02:00:00Z", now)).toBe("Yesterday");
    expect(dayLabel("2026-10-20T15:00:00Z", now)).toBe("Tuesday, October 20");
  });

  it("groups newest first", () => {
    const a = activityItem(run({ id: "a", started_at: "2026-10-27T14:00:00Z" }), "x", null);
    const b = activityItem(run({ id: "b", started_at: "2026-10-26T14:00:00Z" }), "x", null);
    const c = activityItem(run({ id: "c", started_at: "2026-10-27T10:00:00Z" }), "x", null);
    const groups = groupByDay([b, c, a], now);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
    expect(groups[0].items.map((i) => i.runId)).toEqual(["a", "c"]);
  });

  it("finds midnight in Toronto in summer and winter time", () => {
    expect(startOfTodayIso(new Date("2026-10-27T15:00:00Z"))).toBe("2026-10-27T04:00:00.000Z");
    expect(startOfTodayIso(new Date("2026-12-15T15:00:00Z"))).toBe("2026-12-15T05:00:00.000Z");
  });
});

describe("initials", () => {
  it("takes two letters", () => {
    expect(initials("Slack message collector")).toBe("SM");
    expect(initials("Scout")).toBe("SC");
  });
});
