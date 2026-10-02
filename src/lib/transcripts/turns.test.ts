import { describe, it, expect } from "vitest";
import { turnsOf } from "./turns";

describe("turnsOf", () => {
  it("starts a turn at each speaker and joins the lines a recording wrapped", () => {
    expect(
      turnsOf("Weekly Leadership Meeting\n\nAlex Ng: Let's do the check in\nfirst. One thing that went well.\nSpeaker 2: I'll go.\n")
    ).toEqual([
      { speaker: null, words: "Weekly Leadership Meeting" },
      { speaker: "Alex Ng", words: "Let's do the check in first. One thing that went well." },
      { speaker: "Speaker 2", words: "I'll go." },
    ]);
  });

  it("returns nothing for an empty transcript", () => {
    expect(turnsOf("")).toEqual([]);
  });
});
