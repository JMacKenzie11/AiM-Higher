import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Guard against the old measures model coming back.
//
// Migration 0166 turned every function_outcome into a critical
// success factor in `success_measures`, and 0168 dropped both the
// `function_outcomes` table and the `outcome_id` column. Anything
// still naming them would fail at runtime rather than at build time:
// PostgREST answers an unknown table with an error inside the
// response body, and the loaders here read `data` and carry on with
// an empty array. The page renders, just without the measures on it.
//
// That is the failure this test exists to prevent. A silently empty
// success-tracking page is worse than a crash, because nobody
// reports it — it looks like a company that has not entered anything.
//
// Migration files are excluded: they are a historical record and must
// keep saying what they said when they ran.

const ROOT = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

// This file necessarily contains the strings it forbids.
const SELF = join(ROOT, "lib", "measures", "no-legacy-outcomes.test.ts");
const FILES = sourceFiles(ROOT).filter((f) => f !== SELF);
// Tests build FormData from object literals whose keys are form field
// names, which look exactly like an insert patch on one line. The
// patch check below runs against application code only for that
// reason; the select and filter checks still cover every file.
const APP_FILES = FILES.filter((f) => !/\.test\.tsx?$/.test(f));

function offenders(
  pattern: RegExp,
  files: string[] = FILES
): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      // Comments may still describe the history. Only live code counts.
      const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      if (pattern.test(code)) {
        hits.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
      }
    });
  }
  return hits;
}

describe("the dropped outcomes model", () => {
  it("is not queried anywhere", () => {
    // Any string mention in code: a .from(), a select join, a filter
    // path. All of them fail the same silent way.
    expect(offenders(/function_outcomes/)).toEqual([]);
  });

  it("has no outcome_id column left in a query", () => {
    // The chart's own forms still post an `outcome_id` form field,
    // which is fine: that is a CSF's id travelling under an old name
    // through a FormData key, not a column. What must not exist is a
    // query naming the dropped column — a select list, a filter, or
    // an insert/update patch.
    expect(offenders(/\.(eq|in|neq|is|order)\(\s*["']outcome_id["']/)).toEqual(
      []
    );
    expect(offenders(/select\([^)]*\boutcome_id\b/)).toEqual([]);
    // An insert or update patch would set it as an object key with a
    // value that is not a FormData read.
    expect(
      offenders(/^\s*outcome_id:\s*(?!String\()/, APP_FILES)
    ).toEqual([]);
  });

  it("has no transition mirror", () => {
    // mirror.ts wrote every change twice while both models were live.
    // A second writer returning would let the two drift apart again.
    expect(offenders(/measures\/mirror/)).toEqual([]);
    expect(offenders(/mirrorOutcomeToCsf|mirrorMeasureToKpi/)).toEqual([]);
  });
});

describe("migration 0168", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0168_drop_function_outcomes.sql"),
    "utf8"
  );

  it("drops the column before the table it points at", () => {
    // The column carries a foreign key into function_outcomes, so
    // dropping the table first fails on the dependency.
    expect(sql.indexOf("drop column if exists outcome_id")).toBeLessThan(
      sql.indexOf("drop table if exists public.function_outcomes")
    );
  });

  it("drops the policies that read the column", () => {
    // A policy referencing a dropped column blocks the drop. These
    // four are the pre-0166 originals; the function_id-keyed
    // replacements 0166 added are what survive.
    for (const name of [
      "success_measures_select",
      "success_measures_write",
      "success_measures_select_guide",
      "success_measures_write_guide",
    ]) {
      expect(sql).toContain(`drop policy if exists ${name} on`);
    }
  });

  it("does not drop the replacement policies", () => {
    // Dropping these would leave the table readable by nobody.
    expect(sql).not.toContain("success_measures_select_by_function on");
    expect(sql).not.toContain("success_measures_write_by_function on");
  });

  it("rewrites every policy that reached through the dropped column", () => {
    // The first attempt at this migration dropped only the four
    // success_measures policies and hit 2BP01: four more on
    // success_measure_entries joined success_measures to
    // function_outcomes to reach a company.
    //
    // They must be recreated, not merely dropped. These four are the
    // entire policy set on that table, so dropping them without
    // replacements locks every role out of every weekly value.
    for (const name of [
      "success_measure_entries_select",
      "success_measure_entries_write",
      "success_measure_entries_select_guide",
      "success_measure_entries_write_guide",
    ]) {
      expect(sql).toContain(`drop policy if exists ${name} on`);
      expect(sql).toContain(`create policy ${name} on`);
    }
  });

  it("leaves no policy joining through function_outcomes", () => {
    // A recreated policy that still walks the old path would fail on
    // the very next statement, and a reviewer skimming a wall of SQL
    // is exactly who misses one.
    const created = sql.slice(0, sql.indexOf("drop table if exists"));
    expect(created).not.toMatch(/join\s+public\.function_outcomes/);
  });

  it("reaches a company through function_id in the new policies", () => {
    // This is what fixes the CSF bug as well as the drop: on a
    // critical success factor outcome_id is NULL, so the old join
    // matched nothing and every write was denied.
    expect(sql).toMatch(/join public\.functions f on f\.id = m\.function_id/);
    expect(sql).toMatch(/join public\.functions f on f\.id = sm\.function_id/);
  });

  it("makes function_id required", () => {
    // Every RLS policy on the table is keyed on function_id now. A
    // row without one is invisible to its own company.
    expect(sql).toMatch(/alter column function_id set not null/);
  });
});
