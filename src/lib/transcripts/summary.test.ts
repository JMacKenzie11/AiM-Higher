import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { settleSummary, type SummaryPasses } from "./summary";
import { personalDetailMatcher } from "@/lib/voice/personal-detail";

const message = (text: string, stop: Anthropic.Message["stop_reason"] = "end_turn") =>
  ({ content: [{ type: "text", text }], stop_reason: stop }) as unknown as Anthropic.Message;

const passes: SummaryPasses = {
  transcript: "",
  speakerMap: null,
  spell: (text) => ({ text, changes: [] }),
  personalDetail: personalDetailMatcher({ mode: "record", people: ["Pat Kim"] }),
};

const PERSONAL = "The quote goes out Friday. Pat was off sick on Tuesday.";

describe("settleSummary", () => {
  it("keeps a complete summary with a sentence taken out over a rewrite cut off at the limit", async () => {
    const retry = vi.fn(async () => message("The quote goes", "max_tokens"));
    const s = await settleSummary(message(PERSONAL), passes, retry);
    expect(retry).toHaveBeenCalledOnce();
    expect(s.markdown).toBe("The quote goes out Friday.");
    expect(s.truncated).toBe(false);
    expect(s.personalDetail).toEqual({ found: 1, retried: true, removed: 1 });
  });

  it("uses the rewrite when it is complete and clean", async () => {
    const retry = vi.fn(async () => message("The quote goes out Friday. Pat reviewed the numbers."));
    const s = await settleSummary(message(PERSONAL), passes, retry);
    expect(s.markdown).toBe("The quote goes out Friday. Pat reviewed the numbers.");
    expect(s.personalDetail).toEqual({ found: 1, retried: true, removed: 0 });
  });
});
