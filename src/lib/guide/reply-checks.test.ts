import { describe, it, expect } from "vitest";
import { debriefReplyFaults } from "./reply-checks";

// The real second turn, dev, 2026-09-28.
const REAL =
  "That's a fair place to start. Nobody had a bad intent here, and that's usually how a gap like this survives: everyone's answer sounds reasonable on its own. " +
  "Ray assuming the office had it, the office waiting on leadership, that's two people each making a quiet, sensible guess instead of one person asking out loud.";

describe("debriefReplyFaults", () => {
  it("names both faults in the real reply", () => {
    const labels = debriefReplyFaults(REAL, "").map((h) => h.phrase);
    expect(labels).toContain("X instead of Y");
    expect(labels).toContain("affirming by denial");
  });

  it("catches the other denials the prompt names", () => {
    // "not a small thing" is on the banned list too, so it is named twice.
    expect(debriefReplyFaults("That's not a small thing to notice.", "").map((h) => h.phrase)).toContain(
      "affirming by denial"
    );
    expect(debriefReplyFaults("This isn't about blame.", "").map((h) => h.phrase)).toEqual(["affirming by denial"]);
  });

  it("leaves an ordinary reply alone", () => {
    expect(
      debriefReplyFaults(
        "Everyone's answer made sense on its own. Who's best placed to tell the crew before Friday?",
        ""
      )
    ).toEqual([]);
  });

  it("catches a quote nobody said, and passes one somebody did", () => {
    // The real reply, dev, 2026-09-28, against the fixture's own line 79.
    const transcript = "Speaker 2: I want it to stop happening, so yes.\n\nSpeaker 1: Good.";
    const reply =
      'The group didn\'t stop at "who screwed up the schedule this time." "I want it to stop happening, so yes" is about as clean a claim as you\'ll get.';
    const invented = debriefReplyFaults(reply, transcript).filter((h) => h.phrase === "invented quote");
    expect(invented.map((h) => h.context)).toEqual(["who screwed up the schedule this time."]);
  });
});
