import { describe, it, expect } from "vitest";
import { buildSpeller, describeChanges, withinOneEdit } from "./spelling";

const roster = [
  { full_name: "Sherri Mallock" },
  { full_name: "Casey Benson" },
  { full_name: "Woody Aboumrad" },
  { full_name: "Kyle Carey" },
  { full_name: "Jon Billings" },
];
const grandManan = { spelling: "Grand Manan", heard_as: ["Graham and Ann", "Grand Menan"] };

describe("the company's list", () => {
  const fix = buildSpeller({ roster, entries: [grandManan], transcript: "" });

  it("replaces a misheard place exactly, in any case, keeping what follows it", () => {
    const out = fix("A shared Graham and Ann container, and graham and ann's wharf.");
    expect(out.text).toBe("A shared Grand Manan container, and Grand Manan's wharf.");
    expect(out.changes).toHaveLength(2);
  });

  it("matches across a line break inside the phrase", () => {
    expect(fix("the Graham and\nAnn model").text).toBe("the Grand Manan model");
  });

  it("leaves a word that only contains the form, or a part of it", () => {
    expect(fix("Graham and Anne met Graham.").text).toBe("Graham and Anne met Graham.");
  });

  it("replaces the longest form first", () => {
    const f = buildSpeller({
      roster: [],
      entries: [{ spelling: "Grand Manan Island", heard_as: ["Grand Menan Island"] }, grandManan],
      transcript: "",
    });
    expect(f("Grand Menan Island").text).toBe("Grand Manan Island");
  });

  it("does nothing with an empty list", () => {
    const f = buildSpeller({ roster: [], entries: [], transcript: "" });
    expect(f("Graham and Ann").changes).toEqual([]);
  });
});

describe("the company's people", () => {
  it("corrects a name one letter from a roster name", () => {
    const f = buildSpeller({ roster, entries: [], transcript: "I asked Sherry and she said yes." });
    expect(f("Sherry will send the SOPs. Sherry's list too.").text).toBe(
      "Sherri will send the SOPs. Sherri's list too."
    );
  });

  it("leaves an ordinary word the transcript writes in lower case", () => {
    // "wood" is one letter from Woody; "case" from Casey.
    const f = buildSpeller({ roster, entries: [], transcript: "the wood pile, in any case" });
    expect(f("Wood is stacked. Case closed.").text).toBe("Wood is stacked. Case closed.");
  });

  it("leaves a name the company lists as correct as it stands", () => {
    const f = buildSpeller({
      roster,
      entries: [{ spelling: "Kylie", heard_as: [] }],
      transcript: "and Kylie is on the line.",
    });
    expect(f("Kylie will pack.").text).toBe("Kylie will pack.");
    // Without the entry it would have been taken for Kyle.
    const bare = buildSpeller({ roster, entries: [], transcript: "and Kylie is on the line." });
    expect(bare("Kylie will pack.").text).toBe("Kyle will pack.");
  });

  it("leaves a word the transcript never says as a name", () => {
    // The real case: a generated growth edge opening "Carry the
    // generative thread further", on a meeting with Kyle Carey.
    const f = buildSpeller({ roster, entries: [], transcript: "Kyle Carey reported that field services were busy." });
    expect(f("Carry the generative thread further.").text).toBe("Carry the generative thread further.");
  });

  it("leaves a word the transcript capitalises only to start a sentence", () => {
    const f = buildSpeller({ roster, entries: [], transcript: "Carry on. We will.\nCarry that over." });
    expect(f("Carry it.").changes).toEqual([]);
  });

  it("leaves a word inside a longer name: the two real misses", () => {
    const f = buildSpeller({
      roster: [{ full_name: "Jason Mackenzie" }, { full_name: "Mike Smith" }],
      entries: [],
      transcript: "we did have Glenn Mason start, and Arik from Mine Grouting",
    });
    expect(f("New employee Glenn Mason started. Arik (Mine Grouting) owns it.").changes).toEqual([]);
  });

  it("corrects every use once the transcript qualifies the word, so one person has one spelling", () => {
    // Before this, "Send Brendan the playbook" kept Brendan while the
    // rest of the same summary said Brendon.
    const f = buildSpeller({
      roster: [{ full_name: "Brendon Wong" }],
      entries: [],
      transcript: "when I approached the conversation with Brendan early this week",
    });
    expect(f("Send Brendan the playbook. Brendan agreed.").text).toBe("Send Brendon the playbook. Brendon agreed.");
  });

  it("reads a sentence's opening word as a sentence opening, not part of a name", () => {
    // The real Benson transcript: "And Sherry sat in on one of those".
    const f = buildSpeller({ roster, entries: [], transcript: "review or whatever. And Sherry sat in on one. Hi Sherry." });
    expect(f("Sherry sat in.").text).toBe("Sherri sat in.");
  });

  it("never corrects a word from anybody's position", () => {
    const f = buildSpeller({
      roster: [{ full_name: "Mike Smith" }, { full_name: "Arik Way", position: "Project Manager, Mine Grouting" }],
      entries: [],
      transcript: "the work at the site, then Mine said so",
    });
    expect(f("Mine owns it.").changes).toEqual([]);
  });

  it("corrects toward a first name only, never a surname", () => {
    const f = buildSpeller({ roster, entries: [], transcript: "then Carry said" });
    // Carey is Kyle's surname.
    expect(f("then Carry said").changes).toEqual([]);
  });

  it("leaves a word close to two roster names", () => {
    const f = buildSpeller({
      roster: [{ full_name: "Dana Smith" }, { full_name: "Dina Jones" }],
      entries: [],
      transcript: "ask Dena about it",
    });
    expect(f("Dena will call.").changes).toEqual([]);
  });

  it("leaves names shorter than four letters", () => {
    const f = buildSpeller({ roster, entries: [], transcript: "with John today" });
    expect(f("work with John").text).toBe("work with John");
  });

  it("never changes a roster name into another", () => {
    const f = buildSpeller({
      roster: [{ full_name: "Kyle Carey" }, { full_name: "Casey Benson" }],
      entries: [],
      transcript: "",
    });
    // Carey and Casey are one letter apart, and both are real.
    expect(f("Casey and Carey").text).toBe("Casey and Carey");
  });
});

describe("describeChanges", () => {
  it("counts repeats", () => {
    expect(
      describeChanges([
        { from: "Graham and Ann", to: "Grand Manan" },
        { from: "Graham and Ann", to: "Grand Manan" },
        { from: "Sherry", to: "Sherri" },
      ])
    ).toBe("Graham and Ann -> Grand Manan (x2), Sherry -> Sherri");
  });
});

describe("withinOneEdit", () => {
  it("is one insertion, deletion or substitution", () => {
    expect(withinOneEdit("sherri", "sherry")).toBe(true);
    expect(withinOneEdit("woody", "wood")).toBe(true);
    expect(withinOneEdit("woody", "woodys")).toBe(true);
    expect(withinOneEdit("casey", "casey")).toBe(false);
    expect(withinOneEdit("andy", "andre")).toBe(false);
  });
});
