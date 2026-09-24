import { describe, it, expect } from "vitest";
import { buildVocabulary, unverifiedNames, nearMiss } from "./vocabulary";

// Vocabulary derived from what the company already maintains, and
// the honest reporting of what it cannot vouch for.
//
// Grounded in a real Benson Seafood meeting: the plan holds "Grand
// Manan" and the recording says "Graham" five times and "Grand
// Manan" never. The company's own data is what makes the first
// correctable and the second reportable.

const vocab = buildVocabulary({
  roster: [
    { full_name: "Darlene Clinch", position: "Processing Plant Manager" },
    { full_name: "Sherri Alderman", position: "HR Manager" },
    { full_name: "Casey Benson", position: "CEO" },
  ],
  functionTitles: ["Tankhouse Operations", "Shipping & Logistics"],
  planText: [
    "We harvest around Grand Manan and ship RTE product worldwide.",
  ],
});

describe("buildVocabulary", () => {
  it("knows a roster person by their first name alone", () => {
    // Meetings say "Darlene", not "Darlene Clinch".
    expect(vocab.known.has("darlene")).toBe(true);
    expect(vocab.known.has("darlene clinch")).toBe(true);
  });

  it("lifts proper nouns out of the One-Page Plan's free text", () => {
    // "Grand Manan" lives in a purpose statement, not a field named
    // after it.
    expect(vocab.known.has("grand manan")).toBe(true);
  });

  it("picks up acronyms the capitalised pattern would skip", () => {
    expect(vocab.known.has("rte")).toBe(true);
  });

  it("knows the functional chart", () => {
    expect(vocab.known.has("tankhouse")).toBe(true);
  });
});

describe("unverifiedNames", () => {
  it("reports a name the company cannot vouch for", () => {
    const out = unverifiedNames("Casey will talk to Vern about the display.", vocab);
    expect(out).toContain("Vern");
  });

  it("says nothing about names the company holds", () => {
    const out = unverifiedNames("Darlene and Casey discussed Grand Manan.", vocab);
    expect(out).toEqual([]);
  });

  it("joins adjacent unknown words into one name", () => {
    // "Master Packaging" is one supplier, not two mystery words.
    const out = unverifiedNames("Pick the boxes up from Master Packaging.", vocab);
    expect(out).toContain("Master Packaging");
    expect(out).not.toContain("Master");
  });

  it("is not fooled by contractions", () => {
    // "I'll" and "There's" read as capitalised words to a regex and
    // are never names. An earlier version reported I'Ll and There'S.
    const out = unverifiedNames("I'll check. There's a delay. That's fine.", vocab);
    expect(out).toEqual([]);
  });

  it("ignores a capitalised sentence opener", () => {
    const out = unverifiedNames("Okay. Yeah. Thanks everyone.", vocab);
    expect(out).toEqual([]);
  });

  it("reports an acronym nothing in the company mentions", () => {
    const out = unverifiedNames("Send the LMIA paperwork.", vocab);
    expect(out).toContain("LMIA");
  });
});

describe("nearMiss", () => {
  it("corrects toward a name the company actually holds", () => {
    expect(nearMiss("Sherry", vocab)).toBe("Sherri");
  });

  it("offers nothing when there is nothing real to correct toward", () => {
    // The failure this prevents: "correcting" an unverified name to
    // whatever looks closest, which invents a person.
    expect(nearMiss("Vern", vocab)).toBeNull();
  });

  it("says nothing about a name that is already known", () => {
    expect(nearMiss("Darlene", vocab)).toBeNull();
  });
});
