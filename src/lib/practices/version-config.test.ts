import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: vi.fn() }));

import { configFromVersion } from "./version-config";
import { isValidAgentModel, VALID_AGENT_MODELS } from "./models";

// A stored version row, with everything the runtime needs on it.
function row(over: Record<string, unknown> = {}) {
  return {
    id: "v1",
    agent_id: "a1",
    version_number: 3,
    prompt: "stored prompt text",
    chips: ["one", "two"],
    base_prompt_mode: "voice_only",
    skip_setup: true,
    first_turn: "generate",
    scripted_opener: null,
    output_card: { chart_proposal: "ChartProposalCard" },
    tools: ["get_foundation"],
    max_tokens: 8000,
    model: "claude-sonnet-5",
    ...over,
  } as Parameters<typeof configFromVersion>[0];
}

describe("configFromVersion", () => {
  it("takes every field from the row, not from the registry", () => {
    const c = configFromVersion(row());
    expect(c.source).toBe("version");
    expect(c.versionNumber).toBe(3);
    // The prompt is the stored TEXT, never a file path. This is the
    // whole reason a pinned conversation can be reproduced later.
    expect(c.prompt).toBe("stored prompt text");
    expect(c.basePromptMode).toBe("voice_only");
    expect(c.maxTokens).toBe(8000);
    expect(c.chips).toEqual(["one", "two"]);
  });

  it("drops a tool this build does not ship, and keeps the rest", () => {
    // The tool list is code. A version can name one that has since
    // been removed, and a chat must not die of it.
    const c = configFromVersion(
      row({ tools: ["get_foundation", "summon_kraken"] })
    );
    expect(c.tools).toEqual(["get_foundation"]);
  });



  it("drops a model that is not on the allowlist", () => {
    // A typo'd model id is a broken agent found by a client. The
    // column cannot receive one through the action, and this is the
    // second fence for a row that predates the allowlist.
    const c = configFromVersion(row({ model: "claude-sonnet-5-typo" }));
    expect(c.model).toBeNull();
  });

  it("keeps a model that is on the allowlist", () => {
    expect(configFromVersion(row({ model: "claude-haiku-4-5" })).model).toBe(
      "claude-haiku-4-5"
    );
  });

  it("treats a malformed chips value as no chips rather than throwing", () => {
    // jsonb, so the column can hold anything a bad write put there.
    expect(configFromVersion(row({ chips: "not an array" })).chips).toEqual([]);
    expect(configFromVersion(row({ chips: null })).chips).toEqual([]);
  });

  it("falls back to full_coach for an unrecognised base mode", () => {
    expect(configFromVersion(row({ base_prompt_mode: "wat" })).basePromptMode)
      .toBe("full_coach");
  });

  it("nulls an unrecognised first_turn rather than passing it on", () => {
    expect(configFromVersion(row({ first_turn: "sideways" })).firstTurn)
      .toBeNull();
  });
});

describe("the model allowlist", () => {
  it("accepts blank, which means the platform default", () => {
    expect(isValidAgentModel(null)).toBe(true);
    expect(isValidAgentModel("")).toBe(true);
  });

  it("accepts every id it offers", () => {
    for (const m of VALID_AGENT_MODELS) expect(isValidAgentModel(m)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isValidAgentModel("gpt-4")).toBe(false);
    expect(isValidAgentModel("claude-sonnet-5 ")).toBe(false);
  });
});
