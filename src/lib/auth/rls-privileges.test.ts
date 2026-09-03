import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Source-level guards for three privilege holes closed in migration
// 0164. There is no Postgres in this environment, so these read the
// migration history and assert the FINAL definition of each policy —
// the same approach as the similarity-RPC grant test. It cannot prove
// the policies behave correctly at runtime; it does prove nobody has
// quietly reverted the clauses that make them safe.

const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

// The last CREATE POLICY body for a named policy, comments stripped.
function finalPolicyBody(policyName: string): string {
  let latest = "";
  const re = new RegExp(
    `create\\s+policy\\s+${policyName}\\s+on\\s+[\\s\\S]*?;`,
    "gi"
  );
  for (const f of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
    const matches = sql.match(re);
    if (matches) latest = matches[matches.length - 1];
  }
  return latest
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

describe("profiles_update_guide", () => {
  const body = finalPolicyBody("profiles_update_guide");

  it("exists", () => {
    expect(body).not.toBe("");
  });

  it("excludes the caller's own row in BOTH using and with check", () => {
    // The hole: `id <> auth.uid()` was in USING only. Postgres OR's
    // permissive WITH CHECK expressions, so a guide's own row —
    // admitted by profiles_update_self's USING — could be written
    // through THIS policy's WITH CHECK, setting role to
    // company_admin. is_guide_for() reads the pre-update snapshot, so
    // the caller is still a guide at check time and it passes. Net
    // effect: a guide could make themselves a permanent admin of a
    // client, surviving unassignment.
    const usingPart = body.slice(
      body.toLowerCase().indexOf("using"),
      body.toLowerCase().indexOf("with check")
    );
    const checkPart = body.slice(body.toLowerCase().indexOf("with check"));

    expect(usingPart).toMatch(/id\s*<>\s*auth\.uid\(\)/);
    expect(checkPart).toMatch(/id\s*<>\s*auth\.uid\(\)/);
  });

  it("still refuses to grant system_admin or aims_guide", () => {
    const checkPart = body.slice(body.toLowerCase().indexOf("with check"));
    expect(checkPart).toMatch(/role in \('company_admin','team_member'\)/);
  });
});

describe("profiles_update_self", () => {
  const body = finalPolicyBody("profiles_update_self");

  it("pins role, company_id AND status", () => {
    // status was unpinned, so a deactivated user could set themselves
    // active and walk back in. Safe to pin because the only writes to
    // a caller's own status come from the invite-acceptance paths,
    // which use the service-role client and bypass this policy.
    expect(body).toMatch(/role\s*=\s*\(select ap\.role/);
    expect(body).toMatch(/company_id is not distinct from/);
    expect(body).toMatch(/status\s*=\s*\(select public\.auth_profile_status\(\)\)/);
  });

  it("uses a dedicated definer helper for status, not a bare profiles read", () => {
    // Reading public.profiles directly from inside a profiles policy
    // recurses. auth_profile() can't be extended to carry status —
    // CREATE OR REPLACE can't change a return type and dropping it
    // would take 250+ dependent policies with it — hence a second
    // SECURITY DEFINER function.
    let defined = false;
    for (const f of migrationFiles()) {
      const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
      if (/create\s+or\s+replace\s+function\s+public\.auth_profile_status/i.test(sql)) {
        expect(sql).toMatch(/security\s+definer/i);
        expect(sql).toMatch(/\bstable\b/i);
        expect(sql).toMatch(/set\s+search_path\s*=\s*public/i);
        defined = true;
      }
    }
    expect(defined).toBe(true);
  });
});

describe("oauth_credentials read access", () => {
  it("is system_admin only — refresh tokens are not browser-readable", () => {
    // The row carries refresh_token and access_token: long-lived
    // Google credentials for the client's Drive. 0110 widened the
    // policy to company_admin and 0111 added a guide mirror, both for
    // the whole row. Every read in the app uses the service-role
    // client, so nothing needed those.
    const body = finalPolicyBody("oauth_credentials_select");
    expect(body).toMatch(/role\s*=\s*'system_admin'/);
    expect(body).not.toMatch(/company_admin/);
    expect(body).not.toMatch(/is_guide_for/);
  });

  it("has the guide mirror dropped after its last creation", () => {
    // Ordering matters: 0111 creates it, 0164 must drop it later.
    let lastCreate = -1;
    let lastDrop = -1;
    migrationFiles().forEach((f, i) => {
      const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
      if (/create\s+policy\s+oauth_credentials_select_guide/i.test(sql)) {
        lastCreate = i;
      }
      if (/drop\s+policy\s+if\s+exists\s+oauth_credentials_select_guide/i.test(sql)) {
        // 0111 also has a defensive drop before its create; only count
        // a drop that is NOT followed by a create in the same file.
        if (!/create\s+policy\s+oauth_credentials_select_guide/i.test(sql)) {
          lastDrop = i;
        }
      }
    });
    expect(lastCreate).toBeGreaterThanOrEqual(0);
    expect(lastDrop).toBeGreaterThan(lastCreate);
  });
});
