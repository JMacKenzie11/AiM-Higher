import { describe, it, expect } from "vitest";
import { VOICE_RULES_COACH } from "./voice-rules";
import { VOICE_RULES } from "@/lib/strengths/voice-rules";
import { withVoiceRules } from "@/lib/transcripts/analyze";

// The rules that have to hold in EVERY generated voice, held in one
// place so a new surface cannot quietly ship without them.
//
// The header on voice-rules.ts has said "keep both in sync where
// they overlap" since it was written, and until now nothing checked
// that they were. The two lists had already drifted.

const SURFACES: Array<[string, string]> = [
  ["coach", VOICE_RULES_COACH],
  ["strengths", VOICE_RULES],
  // The meeting summariser. It reached production with a four-line
  // style guide of adjectives and no banned list at all, which is
  // the gap this file exists to make visible: the most-read thing
  // Aimee writes was the one surface nobody had checked.
  ["meeting summariser", withVoiceRules("(the analyzer prompt)")],
];

describe("rules every generated voice shares", () => {
  // Affirmation by denial: "that's not a small thing". It makes a
  // compliment sound grudging, because the reader has to work out
  // what was meant from what was ruled out.
  it.each(SURFACES)("%s bans affirmation by denial", (_name, rules) => {
    expect(rules.toLowerCase()).toContain("not a small thing");
    expect(rules.toLowerCase()).toMatch(/say what .*is|say the positive/);
  });

  it.each(SURFACES)("%s bans em dashes", (_name, rules) => {
    expect(rules.toLowerCase()).toMatch(/em.dash/);
  });

  it.each(SURFACES)("%s bans sentence fragments", (_name, rules) => {
    expect(rules.toLowerCase()).toContain("five minutes?");
  });

  // A rule that only says what NOT to write leaves the model
  // nowhere to go, and it reaches for the next nearest tic. Each
  // block has to carry the replacement too.
  it.each(SURFACES)("%s says what to write instead", (_name, rules) => {
    expect(rules.toLowerCase()).toMatch(
      /that's significant|took real discipline|took discipline/
    );
  });
});

// ---- and the differences that must SURVIVE ---------------------
//
// Sharing a core is only safe while the surfaces keep the rules
// that contradict each other. The coach writes in contractions and
// avoids bullets inside a turn; the summariser writes a board-ready
// memo in neither. A future tidy that folded those together would
// damage both, and this is what would stop it.

describe("what the surfaces must NOT share", () => {
  it("keeps the coach conversational", () => {
    expect(VOICE_RULES_COACH).toContain("Contractions throughout");
    expect(VOICE_RULES_COACH).toContain("One question per turn");
  });

  it("keeps the summariser out of the coach's conversational rules", () => {
    const summariser = withVoiceRules("(the analyzer prompt)");
    expect(summariser).not.toContain("One question per turn");
    expect(summariser).not.toContain("Contractions throughout");
    expect(summariser).not.toContain("Avoid bulleted lists");
  });

  it("keeps the brand spelling with the surface that needs it", () => {
    expect(VOICE_RULES).toContain("AiMS (capital A, lowercase i, capital MS)");
  });
});

// Composing two blocks that each carried their own headings left
// "(mandatory, follow strictly) (mandatory, follow strictly):" in
// both files, and a type check cannot see it. Prompt text is read
// by a model, so the only way it goes wrong is by reading badly.
describe("the composed blocks read as prose", () => {
  it.each(SURFACES)("%s has no duplicated heading fragment", (_name, rules) => {
    expect(rules).not.toMatch(/\(mandatory[^)]*\) \(mandatory/);
  });

  it.each(SURFACES)("%s has no empty section or stray blank run", (_name, rules) => {
    expect(rules).not.toMatch(/:\n\s*\n\s*\n/);
    expect(rules).not.toMatch(/\n{3,}/);
  });

  it.each(SURFACES)("%s states the shared rules once, not twice", (_name, rules) => {
    const emDash = rules.match(/Never use em-dashes/g) ?? [];
    expect(emDash.length).toBe(1);
  });
});
