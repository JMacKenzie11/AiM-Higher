import { describe, it, expect } from "vitest";
import { audienceSentence, slugFromTitle } from "./audience";

const base = { allowedRoles: [], accessPredicates: [], feature: null };

describe("audienceSentence", () => {
  it("says everyone when no roles are checked", () => {
    // Empty means EVERY role in this product, not none. Saying
    // "nobody" here would be the sentence lying in the most
    // dangerous direction.
    expect(audienceSentence(base)).toBe(
      "This agent will be visible to everyone in all companies."
    );
  });

  it("names the roles, each pluralised", () => {
    expect(
      audienceSentence({ ...base, allowedRoles: ["company_admin", "system_admin"] })
    ).toBe(
      "This agent will be visible to company admins and system admins in all companies."
    );
  });

  it("uses commas and a final and for three", () => {
    expect(
      audienceSentence({
        ...base,
        allowedRoles: ["company_admin", "aims_guide", "system_admin"],
      })
    ).toBe(
      "This agent will be visible to company admins, guides and system admins in all companies."
    );
  });

  it("adds function leads when the predicate is set", () => {
    expect(
      audienceSentence({
        ...base,
        allowedRoles: ["company_admin"],
        accessPredicates: ["function_lead"],
      })
    ).toBe(
      "This agent will be visible to company admins and anyone who leads a function in all companies."
    );
  });

  it("names the feature when one gates it", () => {
    expect(audienceSentence({ ...base, feature: "classroom" })).toBe(
      "This agent will be visible to everyone in companies with Classroom switched on."
    );
  });

  it("falls back to the raw value for an unknown feature", () => {
    expect(audienceSentence({ ...base, feature: "made_up" })).toContain(
      "companies with made_up switched on"
    );
  });
});

describe("slugFromTitle", () => {
  it("lowercases and hyphenates", () => {
    expect(slugFromTitle("Prepare a Hard Conversation")).toBe(
      "prepare-a-hard-conversation"
    );
  });

  it("drops punctuation and collapses runs", () => {
    expect(slugFromTitle("What's  next?? (really)")).toBe("what-s-next-really");
  });

  it("trims leading and trailing separators", () => {
    expect(slugFromTitle("  -- Hello -- ")).toBe("hello");
  });

  it("returns empty for a title with nothing usable", () => {
    // The action refuses this rather than inventing a slug.
    expect(slugFromTitle("!!!")).toBe("");
  });
});

// The champion seat, named in the sentence an admin reads before
// they publish. An agent that admits somebody the role list does not
// name has to say so here, or the only place that tells the truth
// about who can reach it is the source.
describe("audienceSentence · the AiMS champion", () => {
  it("names the champion alongside the roles", () => {
    expect(
      audienceSentence({
        allowedRoles: ["company_admin"],
        accessPredicates: ["aims_champion"],
        feature: null,
      })
    ).toBe(
      "This agent will be visible to company admins and the AiMS champion in all companies."
    );
  });

  it("names both predicates when an agent carries both", () => {
    const sentence = audienceSentence({
      allowedRoles: ["company_admin"],
      accessPredicates: ["function_lead", "aims_champion"],
      feature: null,
    });
    expect(sentence).toContain("anyone who leads a function");
    expect(sentence).toContain("the AiMS champion");
  });

  it("says nothing about it when the agent does not name it", () => {
    expect(
      audienceSentence({
        allowedRoles: ["company_admin"],
        accessPredicates: [],
        feature: null,
      })
    ).not.toContain("champion");
  });
});
