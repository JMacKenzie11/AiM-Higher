import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Guards on migration 0166, the additive half of the CSF/KPI model.
//
// There is no Postgres in this environment, so these read the SQL and
// assert the properties that make the migration safe to apply while
// the current code is still running. They cannot prove it executes;
// they do prove nobody has quietly removed the parts that keep both
// models valid at once.
//
// Every check below corresponds to a way this migration could look
// finished and still be wrong.

const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");
const FILE = "0166_csf_kpi_model.sql";
const sql = readFileSync(path.join(MIGRATIONS, FILE), "utf8");
const body = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("0166 is additive", () => {
  it("drops no table and no column", () => {
    // The whole point of phase 2 is that a rollback is a redeploy,
    // not a restore. Both models have to stay valid until phase 8.
    expect(body).not.toMatch(/drop\s+table/i);
    expect(body).not.toMatch(/drop\s+column/i);
  });

  it("only ever drops policies it immediately recreates", () => {
    const drops = Array.from(
      body.matchAll(/drop\s+policy\s+if\s+exists\s+(\w+)\s+on/gi)
    ).map((m) => m[1]);
    const creates = Array.from(
      body.matchAll(/create\s+policy\s+(\w+)\s+on/gi)
    ).map((m) => m[1]);
    expect(drops.length).toBeGreaterThan(0);
    for (const name of drops) {
      expect(creates).toContain(name);
    }
  });

  it("widens outcome_id rather than removing it", () => {
    expect(body).toMatch(/alter column outcome_id drop not null/i);
    expect(body).not.toMatch(/drop column.*outcome_id/i);
  });
});

describe("0166 preserves data", () => {
  it("carries the outcome's description into a detail column", () => {
    // Outcomes have a title AND a description. Measures only have
    // `description`, which holds the name. Without `detail` the
    // outcome's descriptive text would be dropped during the
    // backfill, which the current UI renders.
    expect(body).toMatch(/add column if not exists detail text/i);
    expect(body).toMatch(/o\.description,/);
  });

  it("reuses the outcome id as the CSF measure id", () => {
    // Keeps every existing reference to an outcome id resolving, and
    // makes the link backfill a straight join.
    expect(body).toMatch(/select\s*\n?\s*o\.id,/);
  });

  it("backfills the old containment into the link table", () => {
    expect(body).toMatch(
      /insert into public\.csf_kpi_links[\s\S]*select m\.outcome_id, m\.id/i
    );
  });
});

describe("0166 does not start nagging leaders", () => {
  it("migrates CSFs with auto_track false", () => {
    // The performance cron opens a "log this week's value" commitment
    // for every auto_track measure with no entry. Defaulting migrated
    // CSFs to true would hand every function leader a pile of new
    // commitments the moment the cron is restored in phase 6.
    const insert = body.slice(
      body.indexOf("insert into public.success_measures"),
      body.indexOf("-- ---- 4.") === -1
        ? undefined
        : body.indexOf("create table if not exists public.csf_kpi_links")
    );
    expect(insert).toMatch(/auto_track/);
    expect(insert).toMatch(/\bfalse\b/);
  });
});

describe("0166 keeps the new rows visible", () => {
  it("adds success_measures policies that resolve via function_id", () => {
    // REQUIRED. Every pre-existing success_measures policy resolves
    // the company by joining through outcome_id. A CSF has
    // outcome_id NULL, so without these it is invisible to every user
    // role — rows that exist and only the service role can read. That
    // would surface in phase 3 as missing data rather than as a
    // policy gap.
    for (const name of [
      "success_measures_select_by_function",
      "success_measures_write_by_function",
      "success_measures_select_by_function_guide",
      "success_measures_write_by_function_guide",
    ]) {
      expect(body).toMatch(new RegExp(`create policy ${name} on`, "i"));
    }
  });

  it("puts RLS on the link table with all three audiences", () => {
    expect(body).toMatch(/alter table public\.csf_kpi_links enable row level security/i);
    expect(body).toMatch(/alter table public\.csf_kpi_links force row level security/i);
    // system admin + company member, and a guide mirror. A new table
    // without the guide mirror is the recurring gap in this schema.
    expect(body).toMatch(/create policy csf_kpi_links_select on/i);
    expect(body).toMatch(/create policy csf_kpi_links_select_guide on/i);
    expect(body).toMatch(/create policy csf_kpi_links_write on/i);
    expect(body).toMatch(/create policy csf_kpi_links_write_guide on/i);
  });

  it("resolves link-table access through the CSF's function, not client input", () => {
    // The recurring shape of the tenant bugs found in the September
    // audit was a company id that came from somewhere the caller
    // controlled. Here it comes from the linked measure's function.
    const linkPolicies = body.slice(body.indexOf("csf_kpi_links_select"));
    expect(linkPolicies).toMatch(/join public\.functions f on f\.id = m\.function_id/);
  });
});

describe("0166 link table shape", () => {
  it("has no unique constraint on kpi_id", () => {
    // The one-CSF-per-KPI rule is a UI rule. A unique constraint here
    // would contradict the reason for building a link table at all,
    // and someone would have to remember to drop it later.
    expect(body).not.toMatch(/unique\s*\(\s*kpi_id\s*\)/i);
    expect(body).not.toMatch(/kpi_id\s+uuid[^,]*unique/i);
  });

  it("forbids a measure driving itself", () => {
    expect(body).toMatch(/check\s*\(\s*csf_id\s*<>\s*kpi_id\s*\)/i);
  });

  it("indexes the reverse lookup the UI actually does", () => {
    // The PK serves "which KPIs drive this CSF". The UI also asks
    // "which CSFs does this KPI drive" on every KPI row.
    expect(body).toMatch(/create index if not exists csf_kpi_links_kpi_idx/i);
  });

  it("cascades from both sides so a deleted measure leaves no dangling link", () => {
    const table = body.slice(
      body.indexOf("create table if not exists public.csf_kpi_links"),
      body.indexOf("csf_kpi_links_kpi_idx")
    );
    const cascades = table.match(/on delete cascade/gi) ?? [];
    expect(cascades.length).toBe(2);
  });
});

describe("migration ordering", () => {
  it("0166 is the latest migration", () => {
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files[files.length - 1]).toBe(FILE);
  });
});
