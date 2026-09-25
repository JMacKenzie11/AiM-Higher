import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { buildSharedPrefix, prefixed, transcriptInMessage } from "./shared-prefix";

const toolA = { name: "a", input_schema: { type: "object" } } as Anthropic.Tool;
const toolB = { name: "b", input_schema: { type: "object" } } as Anthropic.Tool;
const shared = buildSharedPrefix("Pat: hello.", [toolA, toolB]);

describe("prefixed", () => {
  it("puts the cached transcript first and the call's own instructions after it", () => {
    const r = prefixed(shared, "Do the thing.", toolB);
    expect(r.system).toEqual([
      { type: "text", text: "<transcript>\nPat: hello.\n</transcript>", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Do the thing." },
    ]);
    expect(r.tools).toBe(shared.tools);
    expect(r.tool_choice).toEqual({ type: "tool", name: "b" });
  });

  it("never sends tools to a text call", () => {
    // Given the tools with tool_choice none, the extraction came back
    // empty and the summary was 66 characters (fixture, 2026-09-25).
    const r = prefixed(shared, "Write the summary.", null);
    expect(r.tools).toBeUndefined();
    expect(r.tool_choice).toBeUndefined();
    expect(r.system[0]).toBe(shared.transcript);
  });

  it("without a prefix, behaves as before: own tool only, no cache mark", () => {
    expect(prefixed(undefined, "Do the thing.", toolA)).toEqual({
      system: [{ type: "text", text: "Do the thing." }],
      tools: [toolA],
      tool_choice: { type: "tool", name: "a" },
    });
    expect(prefixed(undefined, "Write.", null)).toEqual({ system: [{ type: "text", text: "Write." }] });
  });
});

describe("transcriptInMessage", () => {
  it("leaves the transcript out of the message when it is already in the system prompt", () => {
    expect(transcriptInMessage(shared, "Pat: hello.")).not.toContain("Pat: hello.");
    expect(transcriptInMessage(undefined, "Pat: hello.")).toBe("<transcript>\nPat: hello.\n</transcript>");
  });
});
