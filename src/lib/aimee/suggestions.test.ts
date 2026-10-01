import { describe, expect, it } from "vitest";
import { LEADERS, panelGreeting, suggestionsFor, type SuggestionEntry } from "./suggestions";

const SAMPLE: SuggestionEntry[] = [
  {
    patterns: ["/commitments"],
    rows: [
      { roles: ["team_member"], questions: ["How do I mark a commitment done?", "What makes a commitment clear?"] },
      { roles: LEADERS, questions: ["How is our follow-through trending?", "a", "b", "c"] },
    ],
  },
  { patterns: ["/classroom/lessons/[slug]", "/classroom/lessons/[slug]/[sectionSlug]"], rows: [{ roles: "all", questions: ["Which lesson should I do next?"] }] },
];

describe("the panel's suggested questions", () => {
  it("gives each role its own questions for the page", () => {
    expect(suggestionsFor("/commitments", "team_member", SAMPLE)).toEqual(["How do I mark a commitment done?", "What makes a commitment clear?"]);
    expect(suggestionsFor("/commitments", "company_admin", SAMPLE)[0]).toBe("How is our follow-through trending?");
  });

  it("offers at most three", () => {
    expect(suggestionsFor("/commitments", "aims_guide", SAMPLE)).toHaveLength(3);
  });

  it("offers nothing to a role the page has no questions for, or on a page with none", () => {
    expect(suggestionsFor("/commitments", "portfolio_admin", SAMPLE)).toEqual([]);
    expect(suggestionsFor("/plan", "team_member", SAMPLE)).toEqual([]);
  });

  it("shares one page's questions with the pages listed beside it", () => {
    expect(suggestionsFor("/classroom/lessons/running-meetings/why", "team_member", SAMPLE)).toEqual(["Which lesson should I do next?"]);
  });

  it("greets by first name, with no dashes", () => {
    expect(panelGreeting("Dana")).toBe("Hi Dana. Ask me about anything on this page, or anything on your mind.");
    expect(panelGreeting(null)).not.toMatch(/[—–]/);
  });
});
