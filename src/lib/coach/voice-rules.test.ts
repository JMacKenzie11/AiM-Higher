import { describe, it, expect } from "vitest";
import { VOICE_RULES_COACH } from "./voice-rules";
import { VOICE_RULES } from "@/lib/strengths/voice-rules";
import { HEADLINE_RULES_FOR_TEST } from "@/lib/guide/headline";
import { withVoiceRules } from "@/lib/transcripts/analyze";

// The rules that have to hold in EVERY generated voice, held in one
// place so a new surface cannot quietly ship without them.
//
// Two rule blocks plus the Guide's headline prompt. The header on
// voice-rules.ts says to keep the first two in sync where they
// overlap, and until now nothing checked that they were.

const SURFACES: Array<[string, string]> = [
  ["coach", VOICE_RULES_COACH],
  ["strengths", VOICE_RULES],
  ["guide headline", HEADLINE_RULES_FOR_TEST],
  // The meeting summariser. It reached production with a four-line
  // style guide of adjectives and no banned list at all, which is
  // the gap this whole file exists to make visible: the most-read
  // thing Aimee writes was the one surface nobody had checked.
  ["meeting summariser", withVoiceRules("(the analyzer prompt)")],
];

describe("rules every generated voice shares", () => {
  // Affirmation by denial: "that's not a small thing". Jason's
  // objection, 2026-09-25, and he asked for it universally.
  //
  // It makes a compliment sound grudging — the reader has to work
  // out what was meant from what was ruled out — and it is a tic
  // rather than a style, which is why it is banned by example
  // rather than described.
  it.each(SURFACES)("%s bans affirmation by denial", (_name, rules) => {
    expect(rules.toLowerCase()).toContain("not a small thing");
    expect(rules.toLowerCase()).toMatch(/say what .*is|say the positive/);
  });

  it.each(SURFACES)("%s bans em dashes", (_name, rules) => {
    expect(rules.toLowerCase()).toMatch(/em.dash/);
  });

  // A rule that only says what NOT to write leaves the model
  // nowhere to go, and it reaches for the next nearest tic. Each
  // block has to carry the replacement too.
  it.each(SURFACES)("%s says what to write instead", (_name, rules) => {
    expect(rules.toLowerCase()).toMatch(/that's significant|took real discipline|took discipline/);
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
    // The extraction removed each moved line from its old home. A
    // line left behind would contradict nothing, but it doubles the
    // block and buries the surface-specific rules underneath it.
    const emDash = rules.match(/Never use em-dashes/g) ?? [];
    expect(emDash.length).toBe(1);
  });
});
