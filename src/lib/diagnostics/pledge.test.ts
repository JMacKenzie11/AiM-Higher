import { describe, it, expect } from "vitest";
import { checkPledgeDraft, draftPledge } from "./pledge";

describe("draftPledge", () => {
  it("is in the owner's voice, names the destination, and makes the promise", () => {
    const text = draftPledge({ ownerName: "Pat Moreau", leadName: "Jason", destination: "faster quoting." });
    expect(text).toContain("Nobody loses their job because of this.");
    expect(text).toContain("goes first to faster quoting.");
    expect(text).toContain("conversation with Jason");
    expect(text.endsWith("Pat")).toBe(true);
    expect(text).not.toMatch(/[–—]/);
  });

  it("leaves the destination out until there is one", () => {
    expect(draftPledge({ ownerName: null, leadName: "Jason", destination: " " })).not.toContain("goes first to");
  });
});

describe("checkPledgeDraft", () => {
  const facts = { ownerName: "Pat Moreau", leadName: "Jason", company: "Acme Fabrication", industry: "Manufacturing", scope: "The 2 estimators", destination: "Faster quoting" };

  it("passes the plain version, which makes every promise", () => {
    expect(checkPledgeDraft(draftPledge(facts), facts).problems).toEqual([]);
  });

  it("names each promise a draft leaves out, a long draft, and a number nobody gave", () => {
    const { problems } = checkPledgeDraft("Hi team, over 6 weeks we will look at our work. Thanks.", facts);
    expect(problems.join(" | ")).toMatch(/12 months.*45 minutes.*individual answers.*states 6/);
    expect(checkPledgeDraft(Array(130).fill("word").join(" "), facts).problems[0]).toMatch(/longer than 120/);
    // A number from the kickoff answers is allowed.
    expect(checkPledgeDraft(`${draftPledge(facts)} Both 2 of you.`, facts).problems).toEqual([]);
  });

  it("refuses the privacy promise turned round, and a guessed pronoun", () => {
    const plain = draftPledge(facts);
    expect(checkPledgeDraft(plain.replace("What you tell them stays with them.", "What you say to Jason stays with you."), facts).problems.join()).toMatch(/stays with Jason/);
    expect(checkPledgeDraft(plain.replace("What you tell them stays with them.", "What you tell him stays with him."), facts).problems.join()).toMatch(/he or she/);
    expect(checkPledgeDraft(plain.replace("What you tell them stays with them.", "What you tell Jason stays with Jason."), facts).problems).toEqual([]);
  });

  it("signs it with the owner's first name, drops dashes and outer quotes", () => {
    const { text } = checkPledgeDraft("“Hi everyone — here goes.”", facts);
    expect(text).toBe("Hi everyone, here goes.\n\nPat");
    expect(checkPledgeDraft("Thanks,\nPat", facts).text).toBe("Thanks,\nPat");
  });
});
