import { describe, it, expect } from "vitest";
import { redactAnalysis, redactionCount } from "./redact";
import { personalDetailMatcher } from "@/lib/voice/personal-detail";

const match = personalDetailMatcher({ mode: "record", people: ["Pat Kim", "Lee Ortiz"] });

const ROW = {
  analysis_markdown: "## Summary\n\n- The quote goes out Friday. Lee was off sick on Tuesday.",
  commitments_json: [
    { description: "Pat sends the quote by Friday" },
    { description: "Cover Lee's shifts while she is on maternity leave" },
  ],
  issues_json: [{ title: "Quote timing" }, { title: "Pat's family emergency" }],
  coverage_json: {
    checked: 2,
    missed: [
      { quote: "I'll chase the supplier", speaker: "Pat", reason: "Pat would chase the supplier" },
      { quote: "I'm taking Mum to hospital", speaker: "Lee", reason: "Lee would be in hospital" },
    ],
  },
  facilitation_review_json: { strengths: [{ title: "Clear owners", note: "Pat named owners. She shared her surgery date." }] },
};

describe("redactAnalysis", () => {
  it("applies the rule to every stored field, and counts what it took", () => {
    const { row, counts } = redactAnalysis(ROW, match);
    expect(row.analysis_markdown).toBe("## Summary\n\n- The quote goes out Friday.");
    expect(row.commitments_json).toEqual([{ description: "Pat sends the quote by Friday" }]);
    expect(row.issues_json).toEqual([{ title: "Quote timing" }]);
    expect(row.coverage_json?.missed.map((m) => m.quote)).toEqual(["I'll chase the supplier"]);
    expect(row.coverage_json?.checked).toBe(2);
    expect(row.facilitation_review_json).toEqual({ strengths: [{ title: "Clear owners", note: "Pat named owners." }] });
    expect(counts).toEqual({ sentences: 2, commitments: 1, issues: 1, missed: 1 });
    expect(redactionCount(counts)).toBe(5);
  });

  it("returns a clean row unchanged", () => {
    const clean = { ...ROW, analysis_markdown: "## Summary\n\n- The quote goes out Friday.", commitments_json: [], issues_json: [], coverage_json: null, facilitation_review_json: null };
    expect(redactAnalysis(clean, match)).toEqual({ row: clean, counts: { sentences: 0, commitments: 0, issues: 0, missed: 0 } });
  });
});
