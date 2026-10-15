import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Sonnet 5 and Haiku 5.5 think by default, and thinking comes out of
// the same max_tokens as the answer. Under a budget of a few hundred
// tokens the model can spend all of it thinking and return no text,
// which each caller turns silently into "no result" (2026-10-14: 21 of
// 204 commitment clarity checks on production). Every short call has
// to ask for no thinking.

const create = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = { create };
  }
  return { default: FakeAnthropic };
});
vi.mock("@/lib/coach/usage", () => ({ logCoachTokenUsage: vi.fn() }));

import { scoreCommitmentClarity } from "@/lib/commitments/clarity";
import { skippedStrength } from "@/lib/coach/strength-check";
import { scoreMeasureDraft } from "./critique";
import { scoreMeasureTarget } from "./target-check";

function reply(text: string) {
  return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 350, output_tokens: 40 } };
}

const draft = {
  description: "Weekly on-time deliveries",
  target: "95%",
  valueType: "percent" as const,
  direction: "higher_is_better" as const,
};

// The three checks moved to Haiku 5.5 (Jason, 2026-10-15), from side
// by side samples on dev where it gave Sonnet's verdict on 29 of 30.
const CHECKS = [
  {
    name: "commitment clarity",
    ok: '{"timeline": true, "success": true, "note": null}',
    run: () => scoreCommitmentClarity("Ship the report", "2026-10-01"),
  },
  {
    name: "measure critique",
    ok: '{"fitHint": null, "descriptionHint": null, "targetHint": null}',
    run: () => scoreMeasureDraft({ ...draft, outcomeTitle: "Customers get what they ordered", outcomeDescription: null }),
  },
  {
    name: "target check",
    ok: '{"ok": true, "hint": null}',
    run: () => scoreMeasureTarget(draft),
  },
] as const;

describe("short model calls ask for no thinking", () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, clarity: process.env.ANTHROPIC_CLARITY_MODEL };
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.ANTHROPIC_CLARITY_MODEL;
    create.mockReset();
  });
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.clarity === undefined) delete process.env.ANTHROPIC_CLARITY_MODEL;
    else process.env.ANTHROPIC_CLARITY_MODEL = saved.clarity;
  });

  for (const check of CHECKS) {
    it(`${check.name}: runs on Haiku 5.5 with thinking off`, async () => {
      create.mockResolvedValue(reply(check.ok));
      expect(await check.run()).not.toBeNull();
      expect(create.mock.calls[0][0]).toMatchObject({ model: "claude-haiku-5-5", thinking: { type: "disabled" } });
    });
  }

  it("the strength check has thinking off", async () => {
    create.mockResolvedValue(reply('{"strength": null, "acknowledged": true}'));
    await skippedStrength({ messages: { create } } as never, "Great with the crew but late on paperwork", "Tell me more.");
    expect(create.mock.calls[0][0].thinking).toEqual({ type: "disabled" });
  });
});
