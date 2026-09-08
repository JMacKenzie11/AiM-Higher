import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Source-level guards for the entitlement history added in migration
// 0173. There is no Postgres in this environment, so these read the
// migration and assert its final shape — the same approach as
// rls-privileges.test.ts and the similarity-RPC grant test. They
// cannot prove the trigger fires; they do prove nobody has quietly
// removed the properties that make the log trustworthy.
//
// What the log is for: company_features is current-state, and
// disabling a feature DELETES the row, so "was this on in August?"
// had no answer. That question was asked in anger on 2026-09-08, when
// the scorecard cron was found to have recorded four disciplines as
// "not enabled" for every company since 2026-08-13 and 37 of the
// affected rows could not be classified either way.

const MIGRATION = path.resolve(
  __dirname,
  "../../../supabase/migrations/0173_company_feature_events.sql"
);

// Comments stripped: the prose explains the very things these
// assertions forbid, and a guard that fires on its own explanation is
// a guard people delete.
const sql = readFileSync(MIGRATION, "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("company_feature_events is append-only", () => {
  it("grants no INSERT, UPDATE or DELETE policy to anyone", () => {
    // The whole value of the log is that a row, once written, is a
    // fact. A policy admitting any write turns it into an assertion.
    const policies = sql.match(/create policy\s+\w+[\s\S]*?;/gi) ?? [];
    // Anchor first. An empty match list would satisfy the assertion
    // below for the wrong reason, and a regex that quietly stops
    // matching is how a guard becomes decoration.
    expect(policies).toHaveLength(2);

    const writePolicies = policies.filter(
      (p) =>
        /for\s+(insert|update|delete|all)\b/i.test(p) &&
        /company_feature_events/i.test(p)
    );
    expect(writePolicies).toEqual([]);
  });

  it("still enables row level security", () => {
    expect(sql).toMatch(
      /alter table public\.company_feature_events enable row level security/i
    );
  });

  it("deliberately does NOT force row level security", () => {
    // Forcing would apply policies to the table owner, and the only
    // writer is a SECURITY DEFINER trigger running as that owner with
    // no INSERT policy to satisfy. Forced, its insert is denied and
    // every write to company_features fails with it. Pinned because
    // every other table in the schema forces it, so this reads as an
    // omission to anyone tidying up.
    expect(sql).not.toMatch(
      /alter table public\.company_feature_events force row level security/i
    );
  });

  it("reads are limited to system admins and assigned guides", () => {
    expect(sql).toMatch(/company_feature_events_select\b/);
    expect(sql).toMatch(/company_feature_events_select_guide\b/);
    expect(sql).toMatch(/is_guide_for\(public\.company_feature_events\.company_id\)/);
  });
});

describe("the history survives the row it describes", () => {
  it("does not foreign-key `feature` back to company_features", () => {
    // An FK to the current-state table would either block the delete
    // this log exists to record, or cascade the history away with it.
    // Either defeats the point entirely.
    expect(sql).not.toMatch(/references\s+public\.company_features/i);
  });

  it("keeps a company_id FK so a deleted tenant takes its history", () => {
    // Different call: a company being removed SHOULD take its
    // entitlement log. There is no tenant left to answer questions
    // about, and retaining it would outlive the data it describes.
    expect(sql).toMatch(
      /company_id uuid not null references public\.companies\(id\) on delete cascade/i
    );
  });
});

describe("the log is written by the database, not the app", () => {
  it("fires on both insert and delete of company_features", () => {
    // Both halves, or the log records grants and silently loses
    // revocations — which is the exact failure it replaces.
    expect(sql).toMatch(
      /after insert or delete on public\.company_features/i
    );
    expect(sql).toMatch(/for each row execute function public\.log_company_feature_change/i);
  });

  it("records 'enabled' on INSERT and 'disabled' on DELETE", () => {
    expect(sql).toMatch(/tg_op = 'INSERT'[\s\S]*?'enabled'/);
    expect(sql).toMatch(/tg_op = 'DELETE'[\s\S]*?'disabled'/);
  });

  it("runs SECURITY DEFINER with a pinned search_path", () => {
    // Definer because the table admits no writer through RLS. Pinned
    // search_path because a mutable one on a definer function is its
    // own vulnerability — same rule as auth_profile() and 0170.
    const fn = sql.match(
      /create or replace function public\.log_company_feature_change[\s\S]*?\$\$;/
    )?.[0];
    expect(fn).toBeDefined();
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = public/i);
  });

  it("constrains action to the two values the replay understands", () => {
    expect(sql).toMatch(/check \(action in \('enabled', 'disabled'\)\)/i);
  });
});

describe("the backfill", () => {
  it("seeds currently-enabled features at their existing enabled_at", () => {
    expect(sql).toMatch(/insert into public\.company_feature_events/i);
    expect(sql).toMatch(/select cf\.company_id, cf\.feature, 'enabled', cf\.enabled_at/i);
  });

  it("is guarded so re-running the migration set cannot double-seed", () => {
    expect(sql).toMatch(/where not exists/i);
  });
});
