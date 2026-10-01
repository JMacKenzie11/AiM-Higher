import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { settleSummary, type SummaryPasses } from "./summary";
import { personalDetailMatcher } from "@/lib/voice/personal-detail";

const message = (text: string) =>
  ({ content: [{ type: "text", text }], stop_reason: "end_turn" }) as unknown as Anthropic.Message;

const passes: SummaryPasses = {
  transcript: "",
  speakerMap: null,
  spell: (text) => ({ text, changes: [] }),
  personalDetail: personalDetailMatcher({ mode: "record", people: ["Pat Kim"] }),
};

// A long summary with one sentence that breaks the rule. On 2026-10-01
// a whole-summary retry of a Benson meeting came back as a fragment and
// replaced 25,000 characters; only the sentence may ever change.
const LONG = [
  "## Attendees",
  "",
  "- Pat Kim",
  "",
  "## Summary",
  "",
  "The quote goes out Friday.  Pat was off sick on Tuesday. The team agreed the rota.",
  "",
  ...Array.from({ length: 40 }, (_, i) => `- Decision ${i + 1}: kept exactly as written.`),
].join("\n");

describe("settleSummary", () => {
  it("rewords only the sentence, and keeps every other line exactly as written", async () => {
    const reword = vi.fn(async () => ["Pat was away on Tuesday."]);
    const s = await settleSummary(message(LONG), passes, reword);
    expect(reword).toHaveBeenCalledWith(["Pat was off sick on Tuesday."]);
    expect(s.markdown).toBe(LONG.replace("Pat was off sick on Tuesday.", "Pat was away on Tuesday.").replace("Friday.  Pat", "Friday. Pat"));
    expect(s.personalDetail).toEqual({ reworded: 1, removed: 0 });
  });

  it("takes the sentence out when the rewrite still breaks the rule, or is a fragment of something else", async () => {
    for (const rewrite of ["Pat was off sick.", null]) {
      const s = await settleSummary(message(LONG), passes, async () => [rewrite]);
      expect(s.markdown).not.toMatch(/sick/);
      expect(s.markdown).toContain("Decision 40: kept exactly as written.");
      expect(s.personalDetail).toEqual({ reworded: 0, removed: 1 });
    }
  });

  it("does not call the rewording model for a clean summary", async () => {
    const reword = vi.fn();
    const clean = LONG.replace(" Pat was off sick on Tuesday.", "");
    expect((await settleSummary(message(clean), passes, reword)).markdown).toBe(clean);
    expect(reword).not.toHaveBeenCalled();
  });
});
