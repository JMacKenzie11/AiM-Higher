import { describe, it, expect } from "vitest";
import {
  fieldChanges,
  promptDiff,
  collapseUnchanged,
  hasAnyChange,
  type ConfigShape,
} from "./config-diff";

const base: ConfigShape = {
  prompt: "a\nb\nc",
  chips: ["one"],
  basePromptMode: "full_coach",
  skipSetup: false,
  firstTurn: null,
  scriptedOpener: null,
  outputCard: {},
  tools: [],
  maxTokens: null,
  model: null,
};

describe("fieldChanges", () => {
  it("reports nothing when nothing moved", () => {
    expect(fieldChanges(base, { ...base })).toEqual([]);
  });

  it("names each field that changed, and says what it was", () => {
    const changes = fieldChanges(base, {
      ...base,
      model: "claude-haiku-4-5",
      maxTokens: 8000,
    });
    expect(changes).toEqual([
      { label: "Token ceiling", before: "not set", after: "8000" },
      { label: "Model", before: "not set", after: "claude-haiku-4-5" },
    ]);
  });

  it("renders an empty list and an empty map readably", () => {
    const changes = fieldChanges(base, { ...base, tools: ["get_foundation"] });
    expect(changes[0]).toEqual({
      label: "Tools",
      before: "none",
      after: "get_foundation",
    });
  });

  it("ignores the prompt, which has its own diff", () => {
    expect(fieldChanges(base, { ...base, prompt: "totally different" })).toEqual(
      []
    );
    expect(hasAnyChange(base, { ...base, prompt: "totally different" })).toBe(
      true
    );
  });
});

describe("promptDiff", () => {
  it("marks an inserted line and leaves the rest alone", () => {
    expect(promptDiff("a\nb", "a\nx\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "x" },
      { kind: "same", text: "b" },
    ]);
  });

  it("marks a removed line", () => {
    expect(promptDiff("a\nx\nb", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "x" },
      { kind: "same", text: "b" },
    ]);
  });

  it("shows a replacement as a removal and an addition", () => {
    expect(promptDiff("a\nold\nb", "a\nnew\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "old" },
      { kind: "added", text: "new" },
      { kind: "same", text: "b" },
    ]);
  });

  it("returns every line as unchanged when they are", () => {
    expect(promptDiff("a\nb", "a\nb").every((l) => l.kind === "same")).toBe(true);
  });

  it("handles one side being empty", () => {
    expect(promptDiff("", "a")).toEqual([
      { kind: "removed", text: "" },
      { kind: "added", text: "a" },
    ]);
  });
});

describe("collapseUnchanged", () => {
  it("replaces a long unchanged run with a count", () => {
    const lines = promptDiff(
      Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"),
      Array.from({ length: 30 }, (_, i) => (i === 15 ? "CHANGED" : `line ${i}`)).join("\n")
    );
    const out = collapseUnchanged(lines, 2);
    const gaps = out.filter((l) => l.kind === "gap");
    expect(gaps.length).toBe(2);
    // The changed lines and their context survive.
    expect(out.some((l) => l.text === "CHANGED")).toBe(true);
    expect(out.length).toBeLessThan(lines.length);
  });

  it("leaves a short diff alone", () => {
    const lines = promptDiff("a\nb", "a\nx\nb");
    expect(collapseUnchanged(lines, 3)).toEqual(lines);
  });
});
