import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  COACHING_CALL_ITEMS_CAN_BE_ADDED,
  coachingReadersLine,
  coachingRunPlan,
  isTeamMeeting,
} from "./coaching";

describe("what an analysis run may write, by kind (0326)", () => {
  it("a team meeting does everything it did before", () => {
    expect(coachingRunPlan("team")).toEqual({
      createCommitments: true,
      fillHeadlines: true,
      raiseNudge: true,
      trackEvent: true,
    });
  });

  it("a row with no kind is a team meeting (the column's default)", () => {
    expect(isTeamMeeting(undefined)).toBe(true);
    expect(isTeamMeeting(null)).toBe(true);
    expect(coachingRunPlan(undefined).createCommitments).toBe(true);
  });

  it("a coaching call writes nothing outside its own analysis", () => {
    expect(coachingRunPlan("coaching")).toEqual({
      createCommitments: false,
      fillHeadlines: false,
      raiseNudge: false,
      trackEvent: false,
    });
  });
});

describe("who can see a coaching call, said in words", () => {
  it("names the coach and the champion", () => {
    expect(coachingReadersLine({ coaches: ["Jason MacKenzie"], champion: "Sam Patel" }, "this call")).toBe(
      "Only Jason MacKenzie (coach) and Sam Patel (AiMS Champion) can see this call."
    );
  });

  it("names every assigned coach", () => {
    expect(
      coachingReadersLine({ coaches: ["Jason MacKenzie", "Kim Lee"], champion: "Sam Patel" }, "these calls")
    ).toBe("Only Jason MacKenzie and Kim Lee (coaches), and Sam Patel (AiMS Champion) can see these calls.");
  });

  it("says so when the company has no champion", () => {
    expect(coachingReadersLine({ coaches: ["Jason MacKenzie"], champion: null }, "this call")).toBe(
      "Only Jason MacKenzie (coach) can see this call."
    );
  });

  it("never uses an em dash", () => {
    const line = coachingReadersLine({ coaches: ["A", "B", "C"], champion: "D" }, "these calls");
    expect(line).not.toMatch(/—/);
  });
});

describe("the add buttons on a coaching call (a clean switch)", () => {
  it("are off", () => {
    expect(COACHING_CALL_ITEMS_CAN_BE_ADDED).toBe(false);
  });

  // While the switch is off, the server side refuses a call too: each
  // of the four Add/Convert actions reads its meeting as a team meeting.
  it("every add-from-a-meeting action reads team meetings only", () => {
    const src = readFileSync(path.join(__dirname, "routing-actions.ts"), "utf8");
    const reads = src.match(/\.from\("meetings"\)[\s\S]*?\.maybeSingle/g) ?? [];
    expect(reads).toHaveLength(4);
    for (const r of reads) expect(r).toContain('.eq("kind", "team")');
  });
});
