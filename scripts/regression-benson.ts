// Compare the dev clone's current analysis of a staged meeting
// against expected values.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/regression-benson.ts
//
// The expectations, and the transcript they came from, are REAL
// CLIENT CONTENT and live in .regression/, which is gitignored. This
// file reads them and is itself safe to commit.
//
// Structured fields only — owners, dates, attendee exclusions, a few
// facts that must not reverse. Model wording varies between runs and
// asserting on it would produce a test that fails for no reason.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isEntryPoint } from "./lib/entry-point.ts";

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
  attendeesMustNotInclude: string[];
  commitments: Array<{
    label: string;
    // ANY ONE of these identifies the item. Deliberately not a
    // phrase match: the model's wording varies run to run, and a
    // regex that tracks wording reports "not extracted" for an item
    // that WAS extracted in different words. That is a false failure
    // shaped exactly like a product bug, and it cost a day.
    anchors: string[];
    owner: string;
    due: string | null;
  }>;
  facts: Record<string, { mustContain: string[]; mustNotContain: string[] }>;
};

async function main() {
  const expected: Expected = JSON.parse(
    readFileSync(".regression/benson-expected.json", "utf8")
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
  const { data: rows } = await db
    .from("commitments")
    .select("description, due_date, owner_id")
    .eq("source_meeting_id", expected.meetingId);
  const { data: people } = await db.from("profiles").select("id, full_name");
  const nameOf = (id: string | null) =>
    people?.find((p) => p.id === id)?.full_name ?? null;

  const md: string = analysis.analysis_markdown;
  let pass = 0;
  let fail = 0;
  const check = (ok: boolean, label: string, detail = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
    ok ? pass++ : fail++;
  };

  console.log(`markdown ${md.length} chars | truncated=${analysis.truncated} | ` +
    `${(rows ?? []).length} commitment rows\n`);

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
      const ownerMatches = (nameOf(row.owner_id) ?? "")
        .toLowerCase()
        .includes(want.owner.toLowerCase());
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
    const ownerOk =
      owner?.toLowerCase().includes(want.owner.toLowerCase()) ||
      got.description.toLowerCase().includes(`likely ${want.owner.toLowerCase()}`);
    const dueOk = want.due === null ? true : got.due_date === want.due;
    check(
      ownerOk && dueOk,
      want.label,
      `owner=${owner ?? "unassigned"}${ownerOk ? "" : ` (want ${want.owner})`}` +
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

  console.log(`\n${pass} pass, ${fail} fail`);
}

if (isEntryPoint(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
