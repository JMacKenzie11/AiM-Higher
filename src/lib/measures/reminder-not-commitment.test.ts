import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A MISSING NUMBER IS A REMINDER, NOT A COMMITMENT.
//
// The Tuesday cron opened a "Log last week's value for X" commitment
// on a function's lead for every measure with no entry. A commitment
// is a promise somebody made; one the system wrote because you had
// not typed a number yet is not that, and it arrived in the same
// list as the promises you did make, with a due date and a red row
// when it passed.
//
// This was already known. Migration 0166 set auto_track false on
// every CSF it migrated, saying so: "Defaulting migrated CSFs to
// true would hand every function leader a pile of new commitments
// the moment the cron is restored." The fix there was to silence 76
// of 89 measures one at a time. Removing the behaviour is the fix
// that does not need repeating.
//
// Source-level, because both halves need a database to run. What is
// checkable here is the wiring, which is what was wrong.

const ROOT = process.cwd();

function codeOf(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("the Tuesday sweep", () => {
  const code = codeOf("src/app/api/cron/performance/route.ts");

  it("does not write commitments", () => {
    expect(code).not.toContain('.from("commitments")');
    expect(code).not.toContain("Log last week's value for");
  });

  it("still raises an issue for an under-target value", () => {
    // The half that stays. An under-target number is a thing to
    // discuss, not a reminder to type something.
    expect(code).toContain("raiseOffTargetIssue");
    expect(code).toContain("isOffTarget");
  });

  it("still only runs for companies on Success Tracking", () => {
    // The gate, unchanged. Both behaviours are gated on it, which is
    // the whole meaning of the feature.
    expect(code).toContain('.eq("feature", "performance_tracking")');
  });
});

describe("the Friday reminder", () => {
  const code = codeOf("src/lib/notifications/service.ts");
  const pending = code.slice(code.indexOf("getPendingMeasuresForUser"));

  it("covers every measure, not the ones a flag left behind", () => {
    // It filtered !auto_track, because the cron was chasing the
    // others with commitments. With the cron no longer writing
    // commitments, anything this excluded would be chased by
    // nothing at all.
    expect(pending).not.toContain("auto_track");
    expect(pending).toContain('.from("success_measures")');
  });

  it("is aimed at the function's lead", () => {
    expect(pending).toContain('.eq("lead_id", userId)');
  });

  it("only fires on a Friday, for a company on Success Tracking", () => {
    expect(code).toContain('isFriday && features.includes("performance_tracking")');
  });
});

describe("the flag itself", () => {
  it("is dropped, and nothing reads it", () => {
    const migration = readFileSync(
      join(ROOT, "supabase/migrations/0232_drop_auto_track.sql"),
      "utf8"
    );
    expect(migration).toMatch(/drop column if exists auto_track/);
  });

  it("is gone from every reader that used to filter on it", () => {
    // Named rather than globbed, so a new reader has to be added
    // here deliberately instead of a wildcard quietly covering it.
    for (const file of [
      "src/lib/notifications/service.ts",
      "src/lib/measures/insights.ts",
      "src/lib/maturity/scorers/measures.ts",
      "src/app/api/cron/performance/route.ts",
      "src/lib/measures/spine.ts",
      "src/lib/measures/grid.ts",
      "src/lib/types.ts",
    ]) {
      expect(codeOf(file), `${file} still reads auto_track`).not.toContain(
        "auto_track"
      );
    }
  });

  it("is gone from the two forms that set it", () => {
    for (const file of [
      "src/app/(app)/measures/EditMeasureForm.tsx",
      "src/app/(app)/chart/InlineForms.tsx",
      "src/app/(app)/chart/function/[id]/AddMetricRow.tsx",
    ]) {
      expect(codeOf(file), `${file} still offers the checkbox`).not.toContain(
        'name="auto_track"'
      );
    }
  });
});
