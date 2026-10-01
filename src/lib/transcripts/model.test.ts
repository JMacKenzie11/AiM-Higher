import { describe, it, expect } from "vitest";
import { callSettings, forStructuredOutput } from "./model";

describe("callSettings", () => {
  it("switches thinking off where the model allows it", () => {
    expect(callSettings("claude-sonnet-5", "off")).toEqual({ thinking: { type: "disabled" } });
  });

  it("puts Opus 5.5 at its lowest effort, which cannot be off (Jason, 2026-10-01)", () => {
    expect(callSettings("claude-opus-5-5", "off")).toEqual({ output_config: { effort: "low" } });
    expect(callSettings("claude-opus-5-5", "adaptive")).toEqual({
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });
  });

  it("carries a JSON format alongside the effort", () => {
    const format = { type: "json_schema" as const, schema: { type: "object" } };
    expect(callSettings("claude-opus-5-5", "off", format)).toEqual({ output_config: { effort: "low", format } });
    expect(callSettings("claude-sonnet-5", "off", format)).toEqual({ thinking: { type: "disabled" }, output_config: { format } });
  });
});

describe("forStructuredOutput", () => {
  it("closes every object and moves the limits the output API refuses into descriptions", () => {
    expect(
      forStructuredOutput({
        type: "object",
        properties: {
          items: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", properties: { n: { type: "integer", minimum: 1, maximum: 5 } } } },
          notes: { type: "array", minItems: 0, maxItems: 8, description: "Notes.", items: { type: "string" } },
        },
      })
    ).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          description: "Exactly 3 items.",
          items: { type: "object", additionalProperties: false, properties: { n: { type: "integer", description: "From 1 to 5." } } },
        },
        notes: { type: "array", minItems: 0, description: "Notes. At most 8 items.", items: { type: "string" } },
      },
    });
  });
});
