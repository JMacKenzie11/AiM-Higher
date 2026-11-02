import { describe, expect, it } from "vitest";
import { matchesCode, type ComparableConfig } from "./follows-code";

const code: ComparableConfig = {
  prompt: "# Coach\n\nAsk one question.",
  chips: ["Start"],
  basePromptMode: "full_coach",
  skipSetup: false,
  firstTurn: null,
  scriptedOpener: null,
  tools: ["get_foundation"],
  maxTokens: null,
  model: null,
};

describe("matchesCode", () => {
  it("is true for a copy of the code, trailing whitespace aside", () => {
    expect(matchesCode({ ...code, prompt: code.prompt + "\n" }, code)).toBe(true);
  });
  it("is false once the prompt was edited", () => {
    expect(matchesCode({ ...code, prompt: code.prompt + " Then wait." }, code)).toBe(false);
  });
  it("is false when only a setting was changed in the Hub", () => {
    // Production's hard-conversation copy: the code's prompt, a token ceiling set by hand.
    expect(matchesCode({ ...code, maxTokens: 8000 }, code)).toBe(false);
    expect(matchesCode({ ...code, model: "claude-sonnet-5" }, code)).toBe(false);
    expect(matchesCode({ ...code, tools: [] }, code)).toBe(false);
    expect(matchesCode({ ...code, chips: ["Begin"] }, code)).toBe(false);
  });
});
