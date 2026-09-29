import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The three clarity-family calls run on a model that thinks by
// default, under budgets of 300 to 400 tokens. Left to its default,
// the model can spend the whole budget thinking and return no text,
// which each of these turns silently into "no result". The request
// has to ask for no thinking.

const create = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = { create };
  }
  return { default: FakeAnthropic };
});

vi.mock("@/lib/coach/usage", () => ({ logCoachTokenUsage: vi.fn() }));

import { scoreCommitmentClarity } from "@/lib/commitments/clarity";
import { scoreMeasureDraft } from "./critique";
import { scoreMeasureTarget } from "./target-check";

function reply(text: string) {
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}

describe("short clarity-family calls ask for no thinking", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    create.mockReset();
  });
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = saved;
  });

  it("commitment clarity", async () => {
    create.mockResolvedValue(
      reply('{"timeline": true, "success": true, "note": null}')
    );
    const score = await scoreCommitmentClarity("Ship the report", "2026-10-01");
    expect(score).toEqual({ timeline: true, success: true, note: null });
    expect(create.mock.calls[0][0].thinking).toEqual({ type: "disabled" });
  });

  it("measure critique", async () => {
    create.mockResolvedValue(
      reply('{"descriptionHint": null, "targetHint": null, "fitHint": null}')
    );
    await scoreMeasureDraft({
      description: "Weekly on-time deliveries",
      target: "95",
      valueType: "percent",
      direction: "higher_is_better",
      outcomeTitle: "Customers get what they ordered",
      outcomeDescription: null,
    });
    expect(create.mock.calls[0][0].thinking).toEqual({ type: "disabled" });
  });

  it("measure target check", async () => {
    create.mockResolvedValue(reply('{"ok": true, "hint": null}'));
    await scoreMeasureTarget({
      description: "Weekly on-time deliveries",
      target: "95",
      valueType: "percent",
      direction: "higher_is_better",
    });
    expect(create.mock.calls[0][0].thinking).toEqual({ type: "disabled" });
  });
});
