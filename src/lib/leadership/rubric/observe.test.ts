import { describe, it, expect } from "vitest";
import { observerSchema, parseReading, questionsBlock } from "./observe";
import { judgedChecks } from "./rubric";
import { transcriptIndex } from "./verify";
import type { RubricFacts } from "./types";

const facts: RubricFacts = {
  goals: [{ id: "p1", title: "Grow the restaurant channel" }],
  priorCommitments: [{ id: "c1", description: "Service the compressor", owner: null, linkedToPriority: false }],
  newCommitments: [],
  measures: [{ id: "m1", name: "On-time", updated: true, offTrack: false }],
  headlineAreas: [{ id: "f1", title: "Operations", sentAhead: false }],
  issuesRaised: 0,
};
const index = transcriptIndex("Dana: Before we start, thank you all for a big week.\nSam: The compressor is serviced and running cold again.");

describe("observerSchema", () => {
  it("keys each answer by a judged check's id, moment before answer", () => {
    const schema = observerSchema() as {
      properties: { answers: { items: { properties: { id: { enum: string[] } } } } };
    };
    const item = schema.properties.answers.items;
    expect(item.properties.id.enum).toEqual(judgedChecks().map((c) => c.id));
    expect(Object.keys(item.properties)).toEqual(["id", "moment", "answer"]);
  });

  it("asks every judged question in the message", () => {
    for (const c of judgedChecks()) expect(questionsBlock()).toContain(`${c.id}: ${c.question}`);
  });
});

describe("parseReading", () => {
  it("keeps a met answer whose moment is in the transcript", () => {
    const { obs, momentsRejected } = parseReading(
      { answers: [{ id: "checkin_held", answer: true, moment: "thank you all for a big week" }] },
      facts,
      index
    );
    expect(obs.judged.checkin_held).toEqual({ met: true, moment: "thank you all for a big week" });
    expect(momentsRejected).toEqual([]);
  });

  it("turns a met answer with a made-up moment into not met, and says so", () => {
    const { obs, momentsRejected } = parseReading(
      { answers: [{ id: "checkin_held", answer: true, moment: "Dana thanked the whole team warmly" }] },
      facts,
      index
    );
    expect(obs.judged.checkin_held.met).toBe(false);
    expect(momentsRejected).toEqual(["checkin_held"]);
  });

  it("keeps a met answer about something not happening without a moment", () => {
    const { obs } = parseReading({ answers: [{ id: "headlines_no_long_stories", answer: true, moment: "" }] }, facts, index);
    expect(obs.judged.headlines_no_long_stories.met).toBe(true);
  });

  it("drops items AiMS HQ did not supply, and reads a missing answer as not met", () => {
    const { obs } = parseReading(
      {
        goals: [{ id: "p1", named_with_status: true }, { id: "made-up", named_with_status: true }],
        prior_commitments: [{ id: "c1", reviewed: true }],
        measures: [{ id: "m1", discussed: true, flagged: false }],
        headline_areas_spoken: ["f1", "f9"],
        topics: [{ title: "Routes", outcome: "somewhere" }],
      },
      facts,
      index
    );
    expect(Object.keys(obs.goals)).toEqual(["p1"]);
    expect(obs.headlineAreasSpoken).toEqual(["f1"]);
    expect(obs.topics[0].outcome).toBe("open");
    expect(obs.judged.values_linked.met).toBe(false);
  });
});
