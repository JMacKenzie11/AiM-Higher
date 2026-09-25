// Compare the dev clone's current analysis of a staged meeting
// against expected values.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/regression-check.ts <name>
//
// <name> is a file in .regression/expected/ without ".json", e.g.
// benson-2026-09-22. The expectations are REAL CLIENT CONTENT and live
// in a private repository cloned into .regression/ (see
// lib/regression-repo.ts). The transcripts are never there: they are
// in the dev database. This file reads both and is safe to commit.
//
// Checked against the analysis's extracted list (commitments_json),
// not the board rows: that is the pipeline's own output, it exists
// whether or not the company has commitment tracking on, and a person
// editing a row on the board does not make the pipeline pass or fail.
//
// Structured fields only — owners, dates, attendee exclusions, a few
// facts that must not reverse. Model wording varies between runs and
// asserting on it would produce a test that fails for no reason.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isEntryPoint } from "./lib/entry-point.ts";
import { REGRESSION_DIR, requireRegressionRepo } from "./lib/regression-repo.ts";

for (const f of [".env.local", ".env.provisioning"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

type Expected = {
  meetingId: string;
  // "provisional" until somebody who was in the meeting has checked it.
  status: "confirmed" | "provisional";
  attendeesMustNotInclude: string[];
  commitments: Array<{
    label: string;
    // ANY ONE of these identifies the item. Deliberately not a
    // phrase match: the model's wording varies run to run, and a
    // regex that tracks wording reports "not extracted" for an item
    // that WAS extracted in different words. That is a false failure
    // shaped exactly like a product bug, and it cost a day.
    anchors: string[];
    // First name, or null for "must come out Unassigned".
    owner: string | null;
    // null: the date is not checked.
    due: string | null;
  }>;
  facts: Record<string, { mustContain: string[]; mustNotContain: string[] }>;
};

async function main() {
  requireRegressionRepo();
  const name = process.argv.slice(2).find((a) => a !== "--");
  if (!name) throw new Error("pass an expectations name, e.g. benson-2026-09-22");
  const expected: Expected = JSON.parse(
    readFileSync(`${REGRESSION_DIR}/expected/${name}.json`, "utf8")
  );
  const db = createClient(
    process.env.LOCAL_INSTANCE_SUPABASE_URL!,
    process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY!
  );

  const { data: analysis } = await db
    .from("meeting_analyses")
    .select("analysis_markdown, truncated, commitments_json")
    .eq("meeting_id", expected.meetingId)
    .maybeSingle();
  if (!analysis) {
    console.log("NO ANALYSIS — run the reanalyze first");
    process.exit(1);
  }
  const rows = ((analysis.commitments_json ?? []) as Array<{
    description: string;
    due_date: string;
    owner_profile_id: string | null;
  }>).map((c) => ({ description: c.description, due_date: c.due_date, owner_id: c.owner_profile_id }));
  const { data: people } = await db.from("profiles").select("id, full_name");
  const nameOf = (id: string | null) =>
    people?.find((p) => p.id === id)?.full_name ?? null;

  const ownerIs = (id: string | null, want: string | null) =>
    want === null
      ? id === null
      : (nameOf(id) ?? "").toLowerCase().startsWith(want.toLowerCase());
  const md: string = analysis.analysis_markdown;
  let pass = 0;
  let fail = 0;
  const check = (ok: boolean, label: string, detail = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
    ok ? pass++ : fail++;
  };

  console.log(`${name} (${expected.status})`);
  console.log(`markdown ${md.length} chars | truncated=${analysis.truncated} | ` +
    `${rows.length} extracted commitments\n`);

  console.log("COMMITMENTS (owner, due):");
  // GLOBAL ASSIGNMENT, not sequential.
  //
  // Two expectations can share an anchor — "danny" appears in both
  // "let Danny know" and "send Danny the worker list". Matching
  // expectations one at a time let whichever came first claim the
  // other's row, and the mismatch then cascaded into a second false
  // failure. Score every pair, assign the strongest first.
  type Row = { description: string; due_date: string; owner_id: string | null };
  const all = (rows ?? []) as Row[];
  const pairs: Array<{ want: (typeof expected.commitments)[number]; row: Row; score: number }> = [];
  for (const want of expected.commitments) {
    for (const row of all) {
      const text = row.description.toLowerCase();
      const hits = want.anchors.filter((a) => text.includes(a.toLowerCase())).length;
      if (hits === 0) continue;
      const ownerMatches = ownerIs(row.owner_id, want.owner);
      const dueMatches = want.due === null || row.due_date === want.due;
      pairs.push({
        want,
        row,
        score: hits * 4 + (ownerMatches ? 2 : 0) + (dueMatches ? 1 : 0),
      });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const assigned = new Map<string, Row>();
  const takenRows = new Set<string>();
  for (const p of pairs) {
    if (assigned.has(p.want.label) || takenRows.has(p.row.description)) continue;
    assigned.set(p.want.label, p.row);
    takenRows.add(p.row.description);
  }

  for (const want of expected.commitments) {
    const got = assigned.get(want.label);
    if (!got) {
      check(false, want.label, "not extracted");
      continue;
    }
    const owner = nameOf(got.owner_id);
    const ownerOk = ownerIs(got.owner_id, want.owner);
    const dueOk = want.due === null ? true : got.due_date === want.due;
    check(
      ownerOk && dueOk,
      want.label,
      `owner=${owner ?? "unassigned"}${ownerOk ? "" : ` (want ${want.owner ?? "unassigned"})`}` +
        ` due=${got.due_date}${dueOk ? "" : ` (want ${want.due})`}`
    );
  }

  console.log("\nATTENDEES:");
  for (const name of expected.attendeesMustNotInclude) {
    check(!md.includes(name), `does not list ${name}`);
  }

  console.log("\nFACTS:");
  for (const [key, rule] of Object.entries(expected.facts)) {
    for (const must of rule.mustContain) {
      check(md.toLowerCase().includes(must.toLowerCase()), `${key}: says "${must}"`);
    }
    for (const mustNot of rule.mustNotContain) {
      check(!md.toLowerCase().includes(mustNot.toLowerCase()), `${key}: avoids "${mustNot}"`);
    }
  }

  console.log(
    `\n${pass} pass, ${fail} fail` +
      (expected.status === "provisional" && fail > 0
        ? "   (PROVISIONAL expectations: a failure may be the file, not the pipeline)"
        : "")
  );
  if (fail > 0) process.exitCode = 1;
}

if (isEntryPoint(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
