import { describe, it, expect, vi } from "vitest";
import { redactAnalysis, redactionCount } from "./redact";
import { personalDetailMatcher } from "@/lib/voice/personal-detail";

const match = personalDetailMatcher({ mode: "record", people: ["Pat Kim", "Lee Ortiz"] });

const ROW = {
  analysis_markdown: "## Summary\n\n- The quote goes out Friday. Lee was off sick on Tuesday.",
  commitments_json: [
    { description: "Pat sends the quote by Friday" },
    { description: "Pat covers Lee's accounts through December while Lee is on maternity leave", clarity_note: "Add a date. Lee is pregnant." },
  ],
  issues_json: [{ title: "Quote timing" }, { title: "Cover while Lee is on sick leave" }],
  coverage_json: {
    checked: 2,
    missed: [
      { quote: "I'll chase the supplier", speaker: "Pat", reason: "Pat would chase the supplier" },
      { quote: "I'm taking Mum to hospital Friday", speaker: "Lee", reason: "Lee would be out Friday" },
    ],
  },
  facilitation_review_json: { strengths: [{ title: "Clear owners", note: "Pat named owners. She shared her surgery date." }] },
};

describe("redactAnalysis", () => {
  it("takes sentences out of prose, rewords items, and keeps and marks what it cannot reword", async () => {
    const reword = vi.fn(async (texts: readonly string[]) =>
      texts.map((t) =>
        t.startsWith("Pat covers") ? "Pat covers Lee's accounts through December" : "Cover while Lee is on sick leave"
      )
    );
    const { row, counts } = await redactAnalysis(ROW, match, reword);

    // One call, for the two items that broke the rule.
    expect(reword).toHaveBeenCalledOnce();
    expect(reword.mock.calls[0][0]).toEqual([
      "Pat covers Lee's accounts through December while Lee is on maternity leave",
      "Cover while Lee is on sick leave",
    ]);

    expect(row.analysis_markdown).toBe("## Summary\n\n- The quote goes out Friday.");
    expect(row.commitments_json).toEqual([
      { description: "Pat sends the quote by Friday" },
      { description: "Pat covers Lee's accounts through December", clarity_note: "Add a date." },
    ]);
    // The rewrite still broke the rule: kept as it was, marked.
    expect(row.issues_json).toEqual([
      { title: "Quote timing" },
      { title: "Cover while Lee is on sick leave", needs_rewording: true },
    ]);
    // A quote is the transcript's words: never reworded, marked.
    expect(row.coverage_json?.missed[1]).toMatchObject({ quote: "I'm taking Mum to hospital Friday", needs_rewording: true });
    expect(row.coverage_json?.missed[0].needs_rewording).toBeUndefined();
    expect(row.facilitation_review_json).toEqual({ strengths: [{ title: "Clear owners", note: "Pat named owners." }] });
    expect(counts).toEqual({ sentences: 3, reworded: 1, flagged: 2 });
    expect(redactionCount(counts)).toBe(6);
  });

  it("never loses an item when rewording fails", async () => {
    const { row } = await redactAnalysis(ROW, match, async (texts) => texts.map(() => null));
    expect(row.commitments_json).toHaveLength(2);
    expect(row.issues_json).toHaveLength(2);
    expect(row.commitments_json[1]).toMatchObject({ description: ROW.commitments_json[1].description, needs_rewording: true });
  });

  it("returns a clean row unchanged, without a rewording call", async () => {
    const clean = { ...ROW, analysis_markdown: "## Summary\n\n- The quote goes out Friday.", commitments_json: [], issues_json: [], coverage_json: null, facilitation_review_json: null };
    const reword = vi.fn();
    expect(await redactAnalysis(clean, match, reword)).toEqual({ row: clean, counts: { sentences: 0, reworded: 0, flagged: 0 } });
    expect(reword).not.toHaveBeenCalled();
  });
});
