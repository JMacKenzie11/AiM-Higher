// The free meeting analysis, run on the invented fixture transcript,
// rendered to a PDF on disk. No database is read or written.
//
//   npm run lead:sample -- --out /tmp/lead          (runs the model)
//   npm run lead:sample -- --out /tmp/lead --from /tmp/lead/result.json
//                                                   (re-renders only)
//
// Writes <out>/result.json and <out>/report.pdf. The second form is
// for working on the layout: the model run takes minutes and costs
// money, and a stored result renders in a second.
//
// Run it with ANTHROPIC_API_KEY and nothing else: with no instance
// configured, the token-usage log inside the facilitation review has
// nowhere to write and says so in a warning, which is the point.
//
//   env -i PATH="$PATH" HOME="$HOME" ANTHROPIC_API_KEY=... npm run lead:sample -- --out /tmp/lead

import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { runLeadAnalysis } from "../src/lib/lead-analysis/analyze.ts";
import { renderLeadReport } from "../src/lib/lead-analysis/pdf/render.tsx";
import type { LeadAnalysisRow } from "../src/lib/lead-analysis/types.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const out = arg("--out");
  if (!out) throw new Error("--out <directory> is required.");
  await fs.mkdir(out, { recursive: true });

  const lead = { fullName: "Dana Whitfield", companyName: "Harbourline Supply", roleTitle: "CEO" };
  let result: Omit<LeadAnalysisRow, "id" | "full_name" | "email" | "company_name" | "role_title" | "file_name" | "transcript_text" | "status" | "error" | "created_by" | "created_at" | "completed_at">;

  const from = arg("--from");
  if (from) {
    result = JSON.parse(await fs.readFile(from, "utf8"));
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
    const transcript = await fs.readFile(path.join("scripts", "fixtures", "leadership-meeting.txt"), "utf8");
    const started = Date.now();
    result = await runLeadAnalysis(new Anthropic({ apiKey }), { transcript, ...lead }, { logUsage: false });
    console.log(`analysed in ${Math.round((Date.now() - started) / 1000)}s`);
    await fs.writeFile(path.join(out, "result.json"), JSON.stringify(result, null, 2));
  }

  const now = new Date().toISOString();
  const row: LeadAnalysisRow = {
    ...result,
    id: "sample",
    full_name: lead.fullName,
    email: "dana@example.com",
    company_name: lead.companyName,
    role_title: lead.roleTitle,
    file_name: "leadership-meeting.txt",
    transcript_text: "",
    status: "complete",
    error: null,
    created_by: null,
    created_at: now,
    completed_at: now,
  };
  const pdf = await renderLeadReport(row);
  await fs.writeFile(path.join(out, "report.pdf"), pdf);
  console.log(`wrote ${path.join(out, "report.pdf")} (${Math.round(pdf.length / 1024)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
