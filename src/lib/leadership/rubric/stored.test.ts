import { describe, it, expect } from "vitest";
import { readStoredRubric, toStoredRubric } from "./stored";
import { withThisMeeting } from "./this-meeting";
import { scoreForRow } from "@/lib/leadership/facilitation/score";
import type { RubricRun } from "./score-meeting";
import type { RubricFacts } from "./types";

const run = {
  score: {
    rubricVersion: 1,
    parts: [{ key: "checkin", name: "Positive check-in", level: 4, wins: [], better: [] }],
    total: 38,
    outOfTen: "7.6",
    split: [],
  },
  results: [],
  counts: {
    speakers: [
      { name: "Dana", words: 600, turns: 20, share: 0.6 },
      { name: "UNKNOWN_SPEAKER", words: 300, turns: 9, share: 0.3 },
      { name: "Jo", words: 100, turns: 5, share: 0.1 },
    ],
    attendees: 2,
    engaged: 2,
    topShare: 0.6,
  },
  readings: 3,
  momentsRejected: [],
  usage: [],
} as unknown as RubricRun;

describe("the stored rubric", () => {
  it("stores the value as total / 5, and the people who spoke, not the unknown voices", () => {
    const s = toStoredRubric(run);
    expect(s.value).toBe(7.6);
    expect(s.talk.speakers?.map((x) => x.name)).toEqual(["Dana", "Jo"]);
    expect(readStoredRubric(s)).toEqual(s);
    expect(readStoredRubric({ total: "38" })).toBeNull();
  });

  it("is the meeting's score wherever a score is read, whatever else the row holds", () => {
    const s = toStoredRubric(run);
    const row = { created_at: "2026-11-28T10:00:00Z", score_positive_framing: 9, score_rhythm: 9, score_accountability: 9, score_alignment: 9, score_agenda: 5, score_weights: { positive_framing: 25, accountability: 25, rhythm: 20, alignment: 15, agenda: 15 } };
    expect(scoreForRow(row, { insufficient_transcript: false, overall: 7.6, rubric: s })).toEqual({
      kind: "rubric",
      value: 7.6,
      total: 38,
      outOfTen: "7.6",
    });
    expect(scoreForRow(row, { insufficient_transcript: false, overall: 7 })?.kind).toBe("computed");
  });
});

describe("withThisMeeting", () => {
  const facts: RubricFacts = { goals: [], priorCommitments: [], newCommitments: [], measures: null, headlineAreas: [], issuesRaised: 0 };
  it("adds this meeting's commitments; By next meeting counts as a date", () => {
    const f = withThisMeeting(facts, {
      commitments: [
        { owner_profile_id: "p1", priority_id: "pr1", due_phrase: null, description: "Send the quote" },
        { owner_profile_id: null, description: "Book overtime" },
      ],
      issues: 2,
    });
    expect(f.newCommitments).toEqual([
      { description: "Send the quote", hasOwner: true, dateNamed: true, linkedToPriority: true },
      { description: "Book overtime", hasOwner: false, dateNamed: true, linkedToPriority: false },
    ]);
    expect(f.issuesRaised).toBe(2);
  });
});
