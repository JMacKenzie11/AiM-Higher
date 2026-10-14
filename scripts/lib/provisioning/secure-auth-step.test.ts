import { describe, expect, it, vi } from "vitest";
import { PROVISION_STEPS, desiredAuthConfig, type ProvisionDeps } from "./plan.ts";
import { routeKeyFor, routeKeyHash } from "../../../src/lib/mcp/route-key.ts";

const step = PROVISION_STEPS.find((s) => s.name === "secure-auth-and-mcp")!;
const ctx = { subdomain: "acme", envPrefix: "ACME", displayName: "Acme", adminEmail: "a@x.invalid", region: "us-east-1", dryRun: false };

function fakes(opts: { auth: Record<string, unknown>; hash: string | null }) {
  let auth = { ...opts.auth };
  let hash = opts.hash;
  const updateAuthConfig = vi.fn(async (_ref: string, patch: Record<string, unknown>) => {
    auth = { ...auth, ...patch };
    return auth;
  });
  const runQuery = vi.fn(async (_ref: string, sql: string) => {
    if (sql.startsWith("select")) return [{ h: hash }];
    hash = /'([0-9a-f]{64})'/.exec(sql)?.[1] ?? null;
    return [];
  });
  const deps = {
    management: { getAuthConfig: vi.fn(async () => auth), updateAuthConfig, runQuery },
    readState: () => ({ subdomain: "acme", projectRef: "ref123", serviceKey: "sb_secret_acme" }),
  } as unknown as ProvisionDeps;
  return { deps, updateAuthConfig, runQuery, hashNow: () => hash };
}

describe("secure-auth-and-mcp", () => {
  it("comes after the seed and before Vercel gets the keys", () => {
    const names = PROVISION_STEPS.map((s) => s.name);
    expect(names.indexOf("secure-auth-and-mcp")).toBe(names.indexOf("seed-data") + 1);
  });

  it("sets the auth settings and writes the route key from the state's service key", async () => {
    const f = fakes({ auth: { disable_signup: false, oauth_server_enabled: false }, hash: null });
    const r = await step.execute(ctx, f.deps);
    expect(r.status).toBe("done");
    const patch = f.updateAuthConfig.mock.calls[0][1];
    expect(patch).toEqual(desiredAuthConfig("acme"));
    // Never the OAuth server.
    expect(patch).not.toHaveProperty("oauth_server_enabled");
    expect(f.hashNow()).toBe(routeKeyHash(routeKeyFor("sb_secret_acme")));
  });

  it("does nothing when all is already right", async () => {
    const f = fakes({ auth: desiredAuthConfig("acme"), hash: routeKeyHash(routeKeyFor("sb_secret_acme")) });
    const r = await step.execute(ctx, f.deps);
    expect(r.status).toBe("skipped");
    expect(f.updateAuthConfig).not.toHaveBeenCalled();
  });

  it("asks for current password, refuses sign-ups and authenticator enrolment", () => {
    expect(desiredAuthConfig("acme")).toMatchObject({
      disable_signup: true,
      mfa_totp_enroll_enabled: false,
      security_update_password_require_current_password: true,
      site_url: "https://acme.aims-hq.com",
    });
  });
});
