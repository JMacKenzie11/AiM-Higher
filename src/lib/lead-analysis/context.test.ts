import { describe, expect, it } from "vitest";
import { commitmentQuality, leadContextBlock, readLeadExtraction, reportFileName } from "./context";

describe("leadContextBlock", () => {
  it("names the company and who asked, and says there is no roster", () => {
    const block = leadContextBlock({ companyName: " Acme Co ", fullName: "Dana Lee", roleTitle: "CEO" });
    expect(block).toContain("<company_context>");
    expect(block).toContain("Name: Acme Co");
    expect(block).toContain("requested by Dana Lee, CEO");
    expect(block).toContain("No purpose, core values, roster or priorities are on file");
    // No core values block, so the analyzer leaves Core Values in Action out.
    expect(block).not.toContain("Core values:");
  });

  it("leaves the role out when there is none", () => {
    expect(leadContextBlock({ companyName: "Acme", fullName: "Dana", roleTitle: null })).toContain(
      "requested by Dana, who"
    );
  });
});

describe("readLeadExtraction", () => {
  it("keeps valid rows and drops the rest", () => {
    const out = readLeadExtraction({
      commitments: [
        {
          owner: "Maya",
          description: "Send the revised schedule",
          due_phrase: "by Friday",
          clarity_timeline: true,
          clarity_success: true,
          clarity_note: "ignored when both pass",
        },
        { owner: null, description: "  ", clarity_timeline: true, clarity_success: true },
        { owner: "", description: "Look into the forklift", clarity_timeline: false, clarity_success: false, clarity_note: "Get two forklift quotes to Leo by Thursday" },
        "not an object",
      ],
      issues: [{ title: "Who owns the calendar" }, { title: "" }, 4],
    });
    expect(out.commitments).toEqual([
      {
        owner: "Maya",
        description: "Send the revised schedule",
        due_phrase: "by Friday",
        clarity_timeline: true,
        clarity_success: true,
        clarity_note: null,
      },
      {
        owner: null,
        description: "Look into the forklift",
        due_phrase: null,
        clarity_timeline: false,
        clarity_success: false,
        clarity_note: "Get two forklift quotes to Leo by Thursday",
      },
    ]);
    expect(out.issues).toEqual([{ title: "Who owns the calendar" }]);
  });

  it("reads a missing or broken answer as empty", () => {
    expect(readLeadExtraction(null)).toEqual({ commitments: [], issues: [] });
    expect(readLeadExtraction({ commitments: "x" })).toEqual({ commitments: [], issues: [] });
  });

  it("treats anything but true as a failed test", () => {
    const [c] = readLeadExtraction({
      commitments: [{ description: "Do it", clarity_timeline: "yes", clarity_success: 1 }],
    }).commitments;
    expect(c.clarity_timeline).toBe(false);
    expect(c.clarity_success).toBe(false);
  });
});

describe("commitmentQuality", () => {
  it("counts each test and both together", () => {
    const c = (t: boolean, s: boolean) => ({
      owner: null,
      description: "x",
      due_phrase: null,
      clarity_timeline: t,
      clarity_success: s,
      clarity_note: null,
    });
    expect(commitmentQuality([c(true, true), c(true, false), c(false, true), c(false, false)])).toEqual({
      total: 4,
      clear: 1,
      withDeadline: 2,
      withDoneDefined: 2,
    });
  });
});

describe("reportFileName", () => {
  it("is safe to put in a header", () => {
    expect(reportFileName('Acme / "Co"', "Dana\nLee")).toBe("Meeting Analysis - Acme Co - Dana Lee.pdf");
  });
});
