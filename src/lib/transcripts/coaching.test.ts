import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  COACHING_CALL_ITEMS_CAN_BE_ADDED,
  COACHING_CALL_NOTES_SHOWN,
  coachingReadersLine,
  withoutScores,
  coachingRunPlan,
  isTeamMeeting,
} from "./coaching";

describe("what an analysis run may write, by kind (0326)", () => {
  it("a team meeting does everything it did before", () => {
    expect(coachingRunPlan("team")).toEqual({
      createCommitments: true,
      fillHeadlines: true,
      trackEvent: true,
      scoreReview: true,
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
      trackEvent: false,
      scoreReview: false,
    });
  });
});

describe("who can see a coaching call, said in words", () => {
  const none = { coaches: [] as string[], admins: [] as string[], viewers: [] as Array<{ name: string }> };

  it("names the coach and the admin", () => {
    expect(coachingReadersLine({ ...none, coaches: ["Jason MacKenzie"], admins: ["Taylor Jones"] }, "this call")).toBe(
      "Only Jason MacKenzie (coach) and Taylor Jones (admin) can see this call."
    );
  });

  it("names coaches, admins and the people added", () => {
    expect(
      coachingReadersLine(
        {
          coaches: ["Jason MacKenzie"],
          admins: ["Taylor Jones", "Anna Lane"],
          viewers: [{ name: "Sam Patel" }],
        },
        "these calls"
      )
    ).toBe("Only Jason MacKenzie (coach), Taylor Jones and Anna Lane (admins), and Sam Patel can see these calls.");
  });

  it("keeps groups apart when the first is a list", () => {
    expect(coachingReadersLine({ ...none, coaches: ["Jason MacKenzie", "Kim Lee"], admins: ["Taylor Jones"] }, "these calls")).toBe(
      "Only Jason MacKenzie and Kim Lee (coaches), and Taylor Jones (admin) can see these calls."
    );
  });

  it("names a person once, under their first group", () => {
    expect(
      coachingReadersLine({ coaches: ["Jason MacKenzie"], admins: ["Jason MacKenzie"], viewers: [{ name: "Jason MacKenzie" }] }, "this call")
    ).toBe("Only Jason MacKenzie (coach) can see this call.");
  });

  it("says who in general when nobody is named", () => {
    expect(coachingReadersLine(none, "this call")).toBe("Only the company's coach and its admins can see this call.");
  });

  it("never uses an em dash", () => {
    const line = coachingReadersLine({ coaches: ["A", "B", "C"], admins: ["D"], viewers: [{ name: "E" }] }, "these calls");
    expect(line).not.toMatch(/—/);
  });
});

describe("the add buttons on a coaching call (a clean switch)", () => {
  it("are on (Jason, 2026-11-18)", () => {
    expect(COACHING_CALL_ITEMS_CAN_BE_ADDED).toBe(true);
  });

  it("leave the Coaching notes tab hidden", () => {
    expect(COACHING_CALL_NOTES_SHOWN).toBe(false);
  });

  // With the switch on, the four Add/Convert actions take a call as
  // well as a team meeting; each says why in a meetings-kind comment.
  it("every add-from-a-meeting action reads either kind, and says so", () => {
    const src = readFileSync(path.join(__dirname, "routing-actions.ts"), "utf8");
    const reads = src.match(/\.from\("meetings"\)[\s\S]*?\.maybeSingle/g) ?? [];
    expect(reads).toHaveLength(4);
    for (const r of reads) expect(r).not.toContain('.eq("kind", "team")');
    expect(src.match(/meetings-kind: both kinds/g) ?? []).toHaveLength(4);
  });
});

describe("a coaching call's review carries no score", () => {
  it("takes out every number and keeps the notes", () => {
    const review = {
      overall: 7.4,
      executive_summary: "Good call.",
      dimensions: {
        rhythm: { score: 3, notes: "r" },
        accountability: { score: 8, notes: "a" },
        alignment: { score: 7, notes: "l" },
        positive_framing: { score: 9, notes: "p" },
      },
      agenda_adherence: { score_out_of_5: 1, notes: "g" },
    };
    const out = withoutScores(review);
    expect(out.overall).toBeNull();
    expect(Object.values(out.dimensions).map((d) => d?.score)).toEqual([null, null, null, null]);
    expect(Object.values(out.dimensions).map((d) => d?.notes)).toEqual(["r", "a", "l", "p"]);
    expect(out.agenda_adherence).toEqual({ score_out_of_5: null, notes: "g" });
    expect(out.executive_summary).toBe("Good call.");
  });
});
