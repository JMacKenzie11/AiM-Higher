import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { LeadReport } from "./LeadReport";
import type { LeadAnalysisRow } from "../types";

// A long report renders. The first real one (2026-10-13) ran a single
// section across about twenty pages, and the page-number footer grew
// on every page until pdfkit threw "unsupported number" and the PDF
// route returned a blank page. The fixture meeting was too short to
// show it. See the header note in LeadReport.tsx.

const paragraph =
  "Sean confirmed with Darlene what the metric measures. It is the share of all swabs that pass on the first attempt, " +
  "with failures re-cleaned until everything passes. A higher first-pass rate therefore directly reduces re-cleaning.";

function longMarkdown(topics: number): string {
  const out = ["## Purpose of the Call", paragraph, "## Detailed Discussions"];
  for (let i = 0; i < topics; i += 1) {
    out.push(
      `### ${String.fromCharCode(65 + (i % 26))}) Topic ${i + 1}`,
      "**What Was Discussed**",
      paragraph,
      paragraph,
      "- **Decided:** the boxes go into use once old stock is gone",
      "- **Open:** next quarter's content goals",
      "  - which depend on Jeff",
      paragraph
    );
  }
  return out.join("\n\n");
}

function row(markdown: string): LeadAnalysisRow {
  return {
    id: "test",
    full_name: "Dana Lee",
    email: "dana@example.com",
    company_name: "Acme Co",
    role_title: "CEO",
    file_name: null,
    transcript_text: "x",
    status: "complete",
    error: null,
    analysis_markdown: markdown,
    truncated: false,
    commitments_json: [],
    issues_json: [],
    facilitation_review_json: null,
    score_positive_framing: null,
    score_rhythm: null,
    score_accountability: null,
    score_alignment: null,
    score_agenda: null,
    score_overall: null,
    score_weights: null,
    model: "test",
    created_by: null,
    created_at: "2026-10-13T00:00:00Z",
    completed_at: "2026-10-13T00:00:00Z",
  };
}

describe("LeadReport", () => {
  it("renders a report whose analysis runs across many pages", async () => {
    const pdf = await renderToBuffer(<LeadReport row={row(longMarkdown(30))} />);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Comfortably past the six pages it took to fail.
    const pages = (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(15);
  }, 60_000);
});
