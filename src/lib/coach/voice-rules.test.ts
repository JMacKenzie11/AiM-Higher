import { describe, it, expect } from "vitest";
import { VOICE_RULES_COACH } from "./voice-rules";
import { VOICE_RULES } from "@/lib/strengths/voice-rules";
import { HEADLINE_RULES_FOR_TEST } from "@/lib/guide/headline";

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
