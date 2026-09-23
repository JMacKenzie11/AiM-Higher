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
