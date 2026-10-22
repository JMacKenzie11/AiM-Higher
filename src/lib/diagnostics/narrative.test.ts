import { describe, it, expect } from "vitest";
import { checkNarrative, findDenials, foreignNumbers, narrativeInput, NARRATIVE_SCHEMA } from "./narrative";
import { assembleReadout, numbersIn, readoutFigures } from "./readout";
import { readoutBundle } from "./readout.fixture";
import { READOUT_SECTIONS } from "./types";

const r = assembleReadout(readoutBundle(), "2026-10-22");
const figures = readoutFigures(r);
const section = (paragraph: string) => ({ evidence: [], paragraph });

describe("reading numbers", () => {
  it("reads digits as the page prints them", () => {
    expect(numbersIn("6 hours, 16.2 projected, 60%, 1,200 quotes.")).toEqual(["6", "16.2", "60", "1200"]);
  });

  it("finds a number the readout does not carry", () => {
    expect(foreignNumbers("You got 6 hours back and will get 16.2 more.", figures)).toEqual([]);
    expect(foreignNumbers("You got 11 hours back.", figures)).toEqual(["11"]);
    // Measured plus projected, blended: never a printed figure.
    expect(foreignNumbers("About 22.2 hours in all.", figures)).toEqual(["22.2"]);
  });
});

describe("the narrative guard", () => {
  it("keeps a paragraph whose every number is in the input, and drops one that invents a number", () => {
    const { narrative, dropped } = checkNarrative(
      {
        hours_back: section("Your first win gave back 6 hours a week. At the same rate, 16.2 more are projected."),
        capacity_map: section("Your team spends about 50 hours a week on draining work."),
        first_win: section("The quote drafts cut each quote from 25 minutes to 10 — every one of the 24 a week."),
      },
      r
    );
    expect(narrative.hours_back).toContain("6 hours");
    expect(narrative.capacity_map).toBeUndefined();
    expect(dropped).toEqual(["capacity_map"]);
    // Dashes come out.
    expect(narrative.first_win).not.toContain("—");
  });

  it("allows the numbers inside the words it prints, like a quote's", () => {
    const withNumber = assembleReadout(readoutBundle({}, {}), "2026-10-22");
    withNumber.quotes = [{ text: "I lose 9 hours a week to this.", name: null }];
    expect(checkNarrative({ in_their_words: section("One estimator says they lose 9 hours a week to it.") }, withNumber).dropped).toEqual([]);
  });

  it("asks for evidence before each paragraph, in the readout's order", () => {
    expect(NARRATIVE_SCHEMA.required).toEqual(READOUT_SECTIONS.map((s) => s.key));
    for (const key of NARRATIVE_SCHEMA.required) {
      const props = Object.keys((NARRATIVE_SCHEMA.properties as Record<string, { properties: object }>)[key].properties);
      expect(props).toEqual(["evidence", "paragraph"]);
    }
  });

  it("gives the model the figures and leaves the map's dots out", () => {
    const input = JSON.parse(narrativeInput(r, "My pledge."));
    expect(input.figures_you_may_use).toEqual(figures);
    expect(input.owner_words_at_kickoff).toBe("My pledge.");
    expect(input.readout.map.points).toBeUndefined();
    expect(input.readout.map).toMatchObject({ tasks_mapped: 7, hours_a_week_on_all_mapped_tasks: 47, draining_routine_tasks: 6, hours_a_week_on_draining_routine_tasks: 37 });
    expect(JSON.stringify(input.readout)).not.toMatch(/Dana Ruiz|Sam Ortiz/);
  });
});

describe("setting a thing against what it is not", () => {
  it("finds the habit and leaves plain sentences alone", () => {
    expect(findDenials("This is where the time goes, not just time saved but time redirected.").map((h) => h.phrase)).toEqual(["not just", "not just time saved but time redirected"]);
    expect(findDenials("That is one task, measured, not a guess.").map((h) => h.phrase)).toEqual(["not a guess"]);
    expect(findDenials("The first win returned 6 hours. Nothing was replaced, and nobody is being let go.")).toEqual([]);
    expect(findDenials("The rest of the roadmap is not set yet.")).toEqual([]);
  });
});

