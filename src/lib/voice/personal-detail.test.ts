import { describe, it, expect } from "vitest";
import {
  findPersonalDetail,
  personalDetailMatcher,
  personalDetailRetryInstruction,
  removePersonalDetail,
} from "./personal-detail";

const PEOPLE = ["Sam Lee", "Darlene Clinch", "Jeff Ortiz"];
const record = { mode: "record" as const, people: PEOPLE };

describe("record mode: a summary or a card", () => {
  it("catches somebody's private life", () => {
    for (const t of [
      "Jeff was away for a doctor's appointment.",
      "Sam is on maternity leave until March.",
      "Darlene missed the meeting because of a family emergency.",
      "Sam was out with the flu.",
      "Darlene's surgery is on Tuesday.",
      "Jeff has been unwell since the weekend.",
      "She shared that her father passed away.",
      "He mentioned his daughter's wedding.",
      "The team sent condolences after the funeral.",
    ]) {
      expect(findPersonalDetail(t, record), t).toHaveLength(1);
    }
  });

  it("leaves a clinic's work and a business's vocabulary alone", () => {
    for (const t of [
      "The front desk rebooked every cancelled appointment.",
      "Sam launched the post-surgery rehab programme.",
      "Darlene reviewed the diagnostic results for the pipeline.",
      "The medical device line grew 12% this quarter.",
      "Jeff will lead the therapy scheduling review.",
      "Pipeline health is strong going into Q4.",
      "The operation ran smoothly.",
      "Parents bring their children to the Saturday clinic.",
      "Sam was away at the trade show.",
    ]) {
      expect(findPersonalDetail(t, record), t).toEqual([]);
    }
  });

  it("knows a person only by the names it is given, or by he and she", () => {
    expect(findPersonalDetail("Priya is recovering from surgery.", record)).toEqual([]);
    expect(findPersonalDetail("Priya is recovering from surgery.", { mode: "record", people: ["Priya Shah"] })).toHaveLength(1);
    expect(findPersonalDetail("She is recovering from surgery.", record)).toHaveLength(1);
  });
});

// Jason, 2026-10-01: time off may be mentioned, never why or where;
// family members' roles in the business are not private.
describe("time off and family", () => {
  it("catches why and where somebody is away", () => {
    for (const t of [
      "Sam is in Mexico for his anniversary.",
      "Sam is on vacation in Mexico next week.",
      "Darlene is away to look after her mother.",
      "Jeff is off because his son is sick.",
      "Sam missed the meeting for his daughter's graduation.",
      "His father is in hospital.",
      "Her mother passed away on Sunday.",
      // A missed commitment quotes the speaker.
      "I'm taking Mum to hospital Friday.",
      "I need to pick up my daughter at three.",
    ]) {
      expect(findPersonalDetail(t, record), t).toHaveLength(1);
    }
  });

  it("lets time off and family businesses through", () => {
    for (const t of [
      "Sam is away next week, so Lee covers Thursday.",
      "Sam is on vacation next week; Darlene runs the stand-up.",
      "Jeff has two days off, back on Wednesday.",
      "His father founded the company.",
      "His father still signs off on pricing.",
      "Her brother runs the Denver branch.",
      "Jeff's daughter joined the sales team in May.",
      "Sam is out next week and his father covers the accounts.",
      "Sam took a trip to the warehouse.",
      "Lee's trip to Toronto is booked for the client review.",
      "My father founded the company.",
      "I'm away next week; Lee has the Thursday call.",
    ]) {
      expect(findPersonalDetail(t, record), t).toEqual([]);
    }
  });
});

describe("moment mode: a short coaching line", () => {
  const moment = personalDetailMatcher({ mode: "moment" });

  it("catches the plain words anywhere", () => {
    for (const t of [
      "Darlene's hospital countdown",
      "her surgery next week",
      "on maternity leave",
      "a grandchild's birth",
      "covering for sick supervisors",
      "how the surgery went",
      "after the diagnosis",
    ]) {
      expect(moment(t), t).not.toBeNull();
    }
  });

  it("leaves work alone", () => {
    for (const t of ["the shutdown plan", "a healthy competition on the floor", "the operation ran smoothly", "a new baseline for sanitation"]) {
      expect(moment(t), t).toBeNull();
    }
  });
});

describe("removing it from a summary", () => {
  const SUMMARY = [
    "### A) Check-In",
    "",
    "- Sam shared a win from the Henderson job. Jeff was away for a doctor's appointment.",
    "- Darlene's surgery is on Tuesday.",
    "- The team agreed the new rota.",
    "",
    "### B) Staffing",
    "",
    "Sam will cover Saturday shifts. She is out with the flu this week, so Jeff takes Friday.",
  ].join("\n");

  it("takes out the sentences and keeps the structure", () => {
    const { text, removed } = removePersonalDetail(SUMMARY, record);
    expect(removed).toBe(3);
    expect(text).toBe(
      [
        "### A) Check-In",
        "",
        "- Sam shared a win from the Henderson job.",
        "- The team agreed the new rota.",
        "",
        "### B) Staffing",
        "",
        "Sam will cover Saturday shifts.",
      ].join("\n")
    );
    expect(findPersonalDetail(text, record)).toEqual([]);
  });

  it("returns the text unchanged when there is nothing to take out", () => {
    const clean = "### A) Pricing\n\n- The team agreed the Q4 price list.";
    expect(removePersonalDetail(clean, record)).toEqual({ text: clean, removed: 0 });
  });
});

describe("the retry instruction", () => {
  it("names each sentence", () => {
    const found = findPersonalDetail("Sam was out with the flu. The rota is agreed.", record);
    const msg = personalDetailRetryInstruction(found);
    expect(msg).toContain('- "Sam was out with the flu."');
    expect(msg).not.toContain("rota");
  });
});
