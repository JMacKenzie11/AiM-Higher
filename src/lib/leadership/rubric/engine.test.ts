import { describe, it, expect } from "vitest";
import { answerChecks, mergeReadings, partLevel, scoreRubric } from "./engine";
import { judgedChecks } from "./rubric";
import type { CheckInput, Observation, RubricFacts, TalkCounts } from "./types";
import { AGENDA_SECTIONS } from "./types";

function allYes(): Observation {
  const judged: Observation["judged"] = {};
  for (const c of judgedChecks()) judged[c.id] = { met: true, moment: "a moment from the meeting" };
  return {
    judged,
    checkinSharers: 4,
    headlineAreasSpoken: ["f1"],
    measures: { m1: { discussed: true, flagged: true } },
    goals: { p1: { namedWithStatus: true } },
    priorCommitments: { c1: { reviewed: true }, c2: { reviewed: true } },
    sections: Object.fromEntries(AGENDA_SECTIONS.map((s) => [s, true])) as Observation["sections"],
    topics: [{ title: "Late routes", outcome: "decided" }],
  };
}

const facts: RubricFacts = {
  goals: [{ id: "p1", title: "Grow the restaurant channel" }],
  priorCommitments: [
    { id: "c1", description: "Service the compressor", owner: "Sam", linkedToPriority: true },
    { id: "c2", description: "Send onboarding packs", owner: "Priya", linkedToPriority: false },
  ],
  newCommitments: [
    { description: "Trial the early load", hasOwner: true, dateNamed: true, linkedToPriority: true },
    { description: "Book overtime", hasOwner: true, dateNamed: true, linkedToPriority: false },
  ],
  measures: [{ id: "m1", name: "On-time delivery", updated: true, offTrack: true }],
  headlineAreas: [{ id: "f1", title: "Operations", sentAhead: false }],
  issuesRaised: 2,
};

const counts: TalkCounts = {
  speakers: [
    { name: "A", words: 300, turns: 20, share: 0.3 },
    { name: "B", words: 250, turns: 15, share: 0.25 },
    { name: "C", words: 250, turns: 15, share: 0.25 },
    { name: "D", words: 200, turns: 10, share: 0.2 },
  ],
  attendees: 4,
  engaged: 4,
  topShare: 0.3,
};

function score(obs: Observation, f: RubricFacts = facts, c: TalkCounts = counts) {
  const input: CheckInput = { obs, facts: f, counts: c };
  return scoreRubric(mergeReadings([answerChecks(input)]));
}

describe("scoreRubric", () => {
  it("gives every part a 5 when every check is met: 50, so 10.0", () => {
    const s = score(allYes());
    expect(s.parts.map((p) => p.level)).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect(s.total).toBe(50);
    expect(s.outOfTen).toBe("10.0");
  });

  it("stops a part at the first level with an open check, whatever is met above it", () => {
    const obs = allYes();
    obs.judged.checkin_real = { met: false, moment: null };
    const s = score(obs);
    expect(s.parts[0].level).toBe(2);
    expect(s.total).toBe(47);
    expect(s.outOfTen).toBe("9.4");
  });

  it("names only the next level's open checks as the step to take", () => {
    const obs = allYes();
    obs.judged.checkin_real = { met: false, moment: null };
    obs.judged.acknowledged_specific = { met: false, moment: null };
    const part = score(obs).parts[0];
    expect(part.better.map((b) => b.id)).toEqual(["checkin_real"]);
    expect(part.wins.map((w) => w.id)).not.toContain("acknowledged_specific");
  });

  it("reads counts from AiMS HQ into the wording", () => {
    const f = { ...facts, measures: [...facts.measures!, { id: "m2", name: "Spoilage", updated: true, offTrack: false }] };
    const part = score(allYes(), f).parts[2];
    expect(part.level).toBe(3);
    expect(part.better[0].text).toBe("Walk every measure on the scorecard (1 of 2 came up this week).");
  });

  it("passes a check that does not apply, and shows it nowhere", () => {
    const f = { ...facts, measures: [{ id: "m1", name: "On-time delivery", updated: true, offTrack: false }] };
    const part = score(allYes(), f).parts[2];
    expect(part.level).toBe(5);
    expect([...part.wins, ...part.better].map((r) => r.id)).not.toContain("off_track_flagged");
  });

  it("falls back to the judged question when the company keeps no scorecard", () => {
    const obs = allYes();
    obs.judged.scorecard_full_said = { met: false, moment: null };
    expect(score(obs, { ...facts, measures: null }).parts[2].level).toBe(3);
  });

  it("never lets a supporting check hold a part back", () => {
    const obs = allYes();
    obs.judged.operational_mentioned = { met: false, moment: null };
    obs.judged.issues_identified_said = { met: false, moment: null };
    const s = score(obs);
    expect(s.parts[4].level).toBe(5);
    expect(s.parts[5].level).toBe(5);
  });

  it("never shows a supporting check", () => {
    const shown = score(allYes()).parts.flatMap((p) => [...p.wins, ...p.better]).map((r) => r.id);
    expect(shown).not.toContain("headlines_everyone");
    expect(shown).not.toContain("operational_mentioned");
  });

  it("marks the meeting down at level 1 when one voice holds more than 65% of the talk", () => {
    const c = { ...counts, topShare: 0.7 };
    expect(score(allYes(), facts, c).parts[9].level).toBe(1);
  });
});

describe("mergeReadings", () => {
  const input = (obs: Observation): CheckInput => ({ obs, facts, counts });

  it("takes the majority of three readings, and records the split", () => {
    const no = allYes();
    no.judged.issues_prioritized = { met: false, moment: null };
    const results = mergeReadings([answerChecks(input(allYes())), answerChecks(input(no)), answerChecks(input(allYes()))]);
    const r = results.find((x) => x.id === "issues_prioritized")!;
    expect(r).toMatchObject({ met: true, agreed: 2, runs: 3 });
    expect(scoreRubric(results).split).toEqual(["issues_prioritized"]);
  });

  it("does not count a tie as met", () => {
    const no = allYes();
    no.judged.issues_prioritized = { met: false, moment: null };
    const results = mergeReadings([answerChecks(input(allYes())), answerChecks(input(no))]);
    expect(results.find((x) => x.id === "issues_prioritized")!.met).toBe(false);
  });
});

describe("partLevel", () => {
  it("is 1 when a level-2 check is open", () => {
    const base = { part: "checkin" as const, source: "judge" as const, na: false, text: "", moment: null, agreed: 1, runs: 1 };
    expect(partLevel([{ ...base, id: "a", level: 2, met: false }, { ...base, id: "b", level: 3, met: true }])).toBe(1);
  });
});
