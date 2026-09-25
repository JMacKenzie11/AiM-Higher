import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  formatSpeakerMap,
  identifiedSpeakers,
  replaceSpeakerLabels,
  type SpeakerMap,
} from "./speakers";

const MAP: SpeakerMap = {
  speakers: [
    { label: "Speaker 1", evidence: "", name: "Casey Benson", confidence: "high" },
    { label: "Speaker 2", evidence: "", name: "Susan Benson", confidence: "medium" },
    { label: "Speaker 5", evidence: "", name: "Shawn Warman", confidence: "low" },
    { label: "Speaker 7", evidence: "", name: null, confidence: "unknown" },
  ],
};

describe("formatSpeakerMap", () => {
  it("passes a low-confidence guess on as unidentified, never as likely X", () => {
    const block = formatSpeakerMap(MAP);
    expect(block).toContain("- Speaker 5 = unidentified.");
    expect(block).not.toMatch(/likely|Shawn Warman|please confirm/i);
    expect(block).toContain("- Speaker 1 = Casey Benson (high)");
  });
});

describe("identifiedSpeakers", () => {
  it("names only high and medium", () => {
    expect(identifiedSpeakers(MAP)).toEqual(["Casey Benson", "Susan Benson"]);
    expect(identifiedSpeakers(null)).toEqual([]);
  });
});

describe("replaceSpeakerLabels", () => {
  it("replaces the real Benson sentences", () => {
    const { text, replaced } = replaceSpeakerLabels(
      "Speaker 5 (likely Shawn Warman) confirmed the plan. Sherri Alderman (referred to by Speaker 4) will notify them.",
      MAP
    );
    expect(text).toBe(
      "An unidentified speaker confirmed the plan. Sherri Alderman (referred to by an unidentified speaker) will notify them."
    );
    expect(replaced).toBe(2);
  });

  it("uses the name when the map stands behind it", () => {
    expect(replaceSpeakerLabels("Send it to Speaker 1 before it goes out.", MAP).text).toBe(
      "Send it to Casey Benson before it goes out."
    );
  });

  it("capitalises at the start of a list item", () => {
    expect(replaceSpeakerLabels("- Speaker 7: asked about pay.", MAP).text).toBe(
      "- An unidentified speaker: asked about pay."
    );
  });

  it("leaves ordinary words alone", () => {
    const input = "Speaker fees were waived and the speakers arrived.";
    expect(replaceSpeakerLabels(input, MAP)).toEqual({ text: input, replaced: 0 });
  });
});

describe("plural labels", () => {
  it("drops a parenthesis of labels from the real attendee line", () => {
    expect(
      replaceSpeakerLabels("- Five unidentified speakers (Speakers 5, 7, 8, 9, 10, 11, 12, 13)", MAP).text
    ).toBe("- Five unidentified speakers");
  });

  it("turns a list of labels in a sentence into one phrase", () => {
    expect(replaceSpeakerLabels("Speakers 7 and 8 agreed.", MAP).text).toBe(
      "unidentified speakers agreed."
    );
  });
});

describe("a label glossed with a label", () => {
  it("does not come out doubled", () => {
    expect(replaceSpeakerLabels("- Speaker 7 (Speaker 7): asked about pay.", MAP).text).toBe(
      "- An unidentified speaker: asked about pay."
    );
  });
});
