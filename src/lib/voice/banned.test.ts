import { describe, it, expect } from "vitest";
import { findBannedPhrases, describeHits, retryInstruction } from "./banned";

// The two that actually got through, taken from real output whose
// prompt banned both by name.
describe("findBannedPhrases", () => {
  it("catches the metaphor that got through the prompt", () => {
    const hits = findBannedPhrases(
      "What made that reframe land in the room, versus just being a good line?"
    );
    expect(hits.map((h) => h.phrase)).toContain("land in the room");
  });

  it("catches a transcript speaker label", () => {
    const hits = findBannedPhrases("Speaker 1's question turned it around.");
    expect(hits.map((h) => h.phrase)).toContain("Speaker 1");
  });

  it("catches affirmation by denial", () => {
    expect(
      findBannedPhrases("That's not a small thing to have in a meeting.").map(
        (h) => h.phrase
      )
    ).toContain("not a small thing");
  });

  it("is case insensitive", () => {
    expect(findBannedPhrases("At The End Of The Day, it shipped.")).toHaveLength(1);
  });

  it("passes clean text", () => {
    expect(
      findBannedPhrases(
        "Three weeks of Tuesday conflicts traced back to nobody owning the calendar."
      )
    ).toEqual([]);
  });

  // A checker people switch off protects nothing. These are ordinary
  // words that the rules ban only as metaphors, and firing on them
  // would make every clean turn look dirty.
  it("does not fire on ordinary uses of banned-as-metaphor words", () => {
    expect(findBannedPhrases("We aim to deliver Tuesday.")).toEqual([]);
    expect(findBannedPhrases("The plane lands at four.")).toEqual([]);
    expect(findBannedPhrases("A gentle slope up from the yard.")).toEqual([]);
    expect(findBannedPhrases("Speaker fees were waived.")).toEqual([]);
  });

  it("reports where, not just that", () => {
    // A log saying "3 violations" sends somebody to read the whole
    // output. This one names the phrase and shows it in place.
    const hits = findBannedPhrases("So, at the end of the day, we shipped it.");
    expect(describeHits(hits)).toContain("at the end of the day");
    expect(describeHits(hits)).toContain("we shipped it");
  });
});

describe("retryInstruction", () => {
  it("quotes the phrase back rather than repeating the rule", () => {
    // The rule was already in the prompt and was already ignored.
    const text = retryInstruction(findBannedPhrases("Let's unpack that."));
    expect(text).toContain('"unpack"');
    expect(text).toContain("without that");
  });

  it("tells it what to do about a speaker label", () => {
    const text = retryInstruction(findBannedPhrases("Speaker 2 raised it."));
    expect(text).toMatch(/do not know who spoke/i);
  });

  it("names every distinct phrase once", () => {
    const text = retryInstruction(
      findBannedPhrases("Let's unpack it and circle back and unpack it again.")
    );
    expect(text.match(/"unpack"/g)).toHaveLength(1);
    expect(text).toContain('"circle back"');
  });
});

// Jason's rule, 2026-09-25: no sentence fragments like "Five
// minutes?". The headline prompt had been instructing that exact
// fragment by example, so the model was doing as it was told.
describe("sentence fragments", () => {
  it("catches the fragment the prompt used to ask for", () => {
    const hits = findBannedPhrases(
      "The team traced it to the root this time. Five minutes?"
    );
    expect(hits.map((h) => h.phrase)).toContain("five minutes?");
  });

  it("catches the other closers of that shape", () => {
    for (const f of ["Worth a look?", "Sound good?", "Thoughts?"]) {
      expect(findBannedPhrases(`Something happened. ${f}`), f).not.toEqual([]);
    }
  });

  it("passes the same invitation written as a whole question", () => {
    expect(
      findBannedPhrases(
        "Do you have five minutes to think about what made that work?"
      )
    ).toEqual([]);
  });

  it("catches quietly, which went straight through a real headline", () => {
    expect(
      findBannedPhrases("You quietly ran out three Tuesdays of conflict.").map(
        (h) => h.phrase
      )
    ).toContain("quietly");
  });
});

// "Land" could not be caught by a list. It is banned as a metaphor
// and ordinary otherwise, and a literal list chased it and kept
// missing: "land in the room" was banned while "made that question
// land this time" walked past, in a turn whose prompt names the
// word.
describe("metaphors matched by shape, not by string", () => {
  it("catches the usage that got through a real opener", () => {
    const hits = findBannedPhrases(
      "What made that question land this time, when it had come up twice before?"
    );
    expect(hits.map((h) => h.phrase)).toContain("land (as a metaphor)");
  });

  it.each([
    "What made it land?",
    "after two weeks of it not landing",
    "That never landed with the crew.",
    "That helped the message land with the crew.",
    "It matters where that lands.",
    "The point landed in the room.",
  ])("catches %s", (text) => {
    expect(findBannedPhrases(text)).not.toEqual([]);
  });

  // ---- AND WHAT IT CANNOT CATCH -----------------------------
  //
  // Stated rather than quietly missing. "The reframe finally
  // landed" and "the plane finally landed" are the same shape; only
  // meaning separates them, and a regex does not have meaning. So
  // the metaphor is caught where it announces itself (a verb
  // driving it, a negation, a pronoun subject) and missed where a
  // concrete-looking noun carries it.
  //
  // The alternative is a pattern that fires on "the plane landed",
  // and a checker that cries wolf is one people switch off. This is
  // a floor under the prompt, not a replacement for it.
  it("misses the metaphor when a noun subject makes it ambiguous", () => {
    expect(findBannedPhrases("The reframe finally landed.")).toEqual([]);
  });

  // The reason it is a pattern and not a ban on the word.
  it.each([
    "The plane lands at four.",
    "We landed the Kenai contract.",
    "Three acres of land behind the yard.",
    "The crew landed safely.",
  ])("leaves the ordinary use alone: %s", (text) => {
    expect(findBannedPhrases(text)).toEqual([]);
  });
});

// Aimee narrating her own machinery. The champion read a line and
// clicked it; naming that line back to them is the product talking
// about itself.
describe("self-narration", () => {
  it.each(["That headline's about the scheduling fix.", "As my note said,", "The notification mentioned it."])(
    "catches %s",
    (text) => {
      expect(findBannedPhrases(text)).not.toEqual([]);
    }
  );
});

// Two faults in one construction: it defines the good thing by what
// it is not, and it joins two independent clauses with a comma.
describe("not X, it was Y", () => {
  it.each([
    "The fix wasn't another patch, it was tracing it to the root.",
    "That isn't a small change, it is a different way of working.",
    "The problem was not the Tuesday, it was the ownership.",
  ])("catches %s", (text) => {
    expect(findBannedPhrases(text).map((h) => h.phrase)).toContain(
      "not X, it was Y"
    );
  });

  // The limit, stated. Knowing whether the first clause is
  // independent is what separates a splice from correct writing,
  // and a regex does not know.
  it("does not attempt general comma splices", () => {
    expect(findBannedPhrases("When the team met, it was clear.")).toEqual([]);
  });
});

describe("minimisers", () => {
  it.each([
    "I just wanted to flag one thing.",
    "Just a quick thought on the calendar.",
    "It's just a scheduling problem.",
  ])("catches %s", (text) => {
    expect(findBannedPhrases(text)).not.toEqual([]);
  });

  it("leaves the ordinary uses of just alone", () => {
    expect(findBannedPhrases("Just the three of them were there.")).toEqual([]);
    expect(findBannedPhrases("They finished just before five.")).toEqual([]);
  });
});

// Jason's additions, 2026-09-25, from a debrief opener that used
// both: "You were in the room for that one", and "instead of" three
// times in four sentences.
describe("the room, and X instead of Y", () => {
  it("catches the room", () => {
    expect(
      findBannedPhrases("You were in the room for that one.").map((h) => h.phrase)
    ).toContain("the room");
  });

  it("catches each instead-of contrast in the real opener", () => {
    const hits = findBannedPhrases(
      'This time it stopped at "who owns the calendar" instead of another patch. ' +
        "That took someone asking what was underneath the pattern instead of just fixing the latest instance."
    ).filter((h) => h.phrase === "X instead of Y");
    expect(hits).toHaveLength(2);
  });

  it("holds the other half to one clause, like not X, it was Y", () => {
    const hits = findBannedPhrases(
      "They chose the crew instead of us, and the rest of this sentence is not part of it."
    ).filter((h) => h.phrase === "X instead of Y");
    expect(hits).toHaveLength(1);
    expect(hits[0].context).not.toContain("rest of this sentence is not");
  });

  it("tells the retry to drop the contrast", () => {
    const text = retryInstruction(findBannedPhrases("It worked instead of stalling."));
    expect(text).toMatch(/without what did not/);
  });
});
