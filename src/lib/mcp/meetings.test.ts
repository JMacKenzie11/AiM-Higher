import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { analysisState, nameSpeakers } from "./meetings";
import { measureWeeks, streakOf, weekHit } from "./reads";

const src = readFileSync(join(__dirname, "meetings.ts"), "utf8");

// Source checks, as reads.test.ts does for reads.ts. The database is the
// boundary (0327: the two functions decide who gets the transcript);
// these keep this file from asking for more.
describe("meetings.ts asks only for what 0327 allows", () => {
  it("calls only the two meeting functions and the people one", () => {
    const rpcs = [...src.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(rpcs)).toEqual(new Set(["assistant_meetings", "assistant_meeting_full", "assistant_company_people"]));
  });
  it("reads only commitments and profiles directly, never a meeting table", () => {
    const tables = [...src.matchAll(/\.from\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["commitments", "profiles"]));
  });
  it("names its columns and writes nothing", () => {
    expect(src).not.toMatch(/\.select\(\s*["'`]\s*\*/);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(src).not.toContain("createSupabaseAdminClient");
  });
});

describe("naming the speakers in a transcript", () => {
  const map = [
    { label: "Speaker 1", name: "Casey Benson", confidence: "high" },
    { label: "Speaker 2", name: "Ashley Moore", confidence: "medium" },
    { label: "Speaker 3", name: "Pinky", confidence: "low" },
    { label: "Speaker 4", name: null, confidence: "unknown" },
  ];
  it("names a turn's label when the analyzer was sure enough, keeping the label", () => {
    const t = "Speaker 1: Morning all.\nSpeaker 2  0:14\nGood week.\nSpeaker 3: Yeah.\nSpeaker 4: Mm.";
    expect(nameSpeakers(t, map)).toBe(
      "Casey Benson (Speaker 1): Morning all.\nAshley Moore (Speaker 2)  0:14\nGood week.\nSpeaker 3: Yeah.\nSpeaker 4: Mm."
    );
  });
  it("leaves a label mentioned mid-line alone", () => {
    expect(nameSpeakers("I agree with Speaker 1 there.", map)).toBe("I agree with Speaker 1 there.");
  });
  it("does not take Speaker 1 for Speaker 12", () => {
    expect(nameSpeakers("Speaker 12: hi", map)).toBe("Speaker 12: hi");
  });
  it("returns the transcript as it was with no map", () => {
    expect(nameSpeakers("Speaker 1: hi", null)).toBe("Speaker 1: hi");
  });
});

describe("whether an analysis is ready to build from", () => {
  it("is ready only when finished and not cut off", () => {
    expect(analysisState({ status: "complete", analysed_at: "2026-11-17", truncated: false })).toBe("ready");
    expect(analysisState({ status: "complete", analysed_at: "2026-11-17", truncated: true })).toMatch(/^cut off/);
    expect(analysisState({ status: "analyzing", analysed_at: null, truncated: false })).toBe("in progress");
    expect(analysisState({ status: "failed", analysed_at: null, truncated: false })).toBe("failed");
  });
});

describe("measure weeks, hits and streaks", () => {
  it("turns a date range into week-ending Fridays, at most 52", () => {
    expect(measureWeeks("UTC", { from: "2026-11-02", to: "2026-11-18" })).toEqual(["2026-11-06", "2026-11-13", "2026-11-20"]);
    expect(measureWeeks("UTC", { from: "2020-01-01", to: "2026-11-18" })).toHaveLength(52);
  });
  const m = { target: "10", value_type: "number" as const, target_direction: "higher_is_better" as const };
  it("judges a week against the target in force that week", () => {
    const history = [
      { measure_id: "m", target: "5", value_type: "number" as const, target_direction: "higher_is_better" as const, effective_from: "2026-10-02" },
      { measure_id: "m", target: "10", value_type: "number" as const, target_direction: "higher_is_better" as const, effective_from: "2026-11-06" },
    ];
    expect(weekHit(m, history, { week_ending: "2026-10-30", value_number: 7, value_text: null })).toEqual({ target: "5", hit: true });
    expect(weekHit(m, history, { week_ending: "2026-11-13", value_number: 7, value_text: null })).toEqual({ target: "10", hit: false });
  });
  it("leaves a week with no value unjudged", () => {
    expect(weekHit(m, [], { week_ending: "2026-11-13", value_number: null, value_text: null }).hit).toBeNull();
  });
  it("counts weeks on target back from the newest", () => {
    expect(streakOf([{ hit: true }, { hit: false }, { hit: true }, { hit: true }])).toBe(2);
    expect(streakOf([{ hit: true }, { hit: null }])).toBe(0);
  });
});
