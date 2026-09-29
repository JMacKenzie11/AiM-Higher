import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The three clarity-family calls run on a model that thinks by
// default, under budgets of 300 to 400 tokens. Left to its default,
// the model can spend the whole budget thinking and return no text,
// which each of these turns silently into "no result". The request
// has to ask for no thinking; each logs under its own label (they
// shared "clarity" until 0243, so an empty one could not be traced);
// and an empty result is said out loud and flagged on the usage row.

const create = vi.hoisted(() => vi.fn());
const logCoachTokenUsage = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = { create };
  }
  return { default: FakeAnthropic };
});

vi.mock("@/lib/coach/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/coach/usage")>()),
  logCoachTokenUsage,
}));

import { scoreCommitmentClarity } from "@/lib/commitments/clarity";
import { scoreMeasureDraft } from "./critique";
import { scoreMeasureTarget } from "./target-check";

const USAGE = { input_tokens: 350, output_tokens: 120 };

function reply(text: string) {
  return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: USAGE };
}

// What 2026-09-29's failure looked like: a thinking block and nothing else.
function thoughtOnly(cap: number) {
  return {
    content: [{ type: "thinking", thinking: "...", signature: "s" }],
    stop_reason: "max_tokens",
    usage: { input_tokens: 350, output_tokens: cap },
  };
}

const CALLS = [
  {
    label: "commitment_clarity",
    ok: '{"timeline": true, "success": true, "note": null}',
    cap: 400,
    run: () => scoreCommitmentClarity("Ship the report", "2026-10-01"),
  },
  {
    label: "measure_critique",
    ok: '{"descriptionHint": null, "targetHint": null, "fitHint": null}',
    cap: 400,
    run: () =>
      scoreMeasureDraft({
        description: "Weekly on-time deliveries",
        target: "95",
        valueType: "percent",
        direction: "higher_is_better",
        outcomeTitle: "Customers get what they ordered",
        outcomeDescription: null,
      }),
  },
  {
    label: "measure_target_check",
    ok: '{"ok": true, "hint": null}',
    cap: 300,
    run: () =>
      scoreMeasureTarget({
        description: "Weekly on-time deliveries",
        target: "95",
        valueType: "percent",
        direction: "higher_is_better",
      }),
  },
] as const;

describe("short clarity-family calls", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    create.mockReset();
    logCoachTokenUsage.mockReset();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = saved;
    errorSpy.mockRestore();
  });

  for (const call of CALLS) {
    it(`${call.label}: asks for no thinking and logs under its own label`, async () => {
      create.mockResolvedValue(reply(call.ok));
      expect(await call.run()).not.toBeNull();
      expect(create.mock.calls[0][0].thinking).toEqual({ type: "disabled" });
      expect(logCoachTokenUsage).toHaveBeenCalledTimes(1);
      expect(logCoachTokenUsage.mock.calls[0][0]).toMatchObject({
        purpose: call.label,
        emptyResult: false,
      });
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it(`${call.label}: an empty result is flagged and said out loud`, async () => {
      create.mockResolvedValue(thoughtOnly(call.cap));
      expect(await call.run()).toBeNull();
      expect(logCoachTokenUsage.mock.calls[0][0]).toMatchObject({
        purpose: call.label,
        emptyResult: true,
      });
      const line = String(errorSpy.mock.calls[0][0]);
      expect(line).toContain(`[${call.label}]`);
      expect(line).toContain("stop_reason=max_tokens");
    });
  }
});
