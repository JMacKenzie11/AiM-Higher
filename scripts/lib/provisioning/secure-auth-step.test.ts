import { describe, expect, it, vi } from "vitest";
import { PROVISION_STEPS, desiredAuthConfig, withInstance, type ProvisionDeps } from "./plan.ts";
import { routeKeyHash } from "../../../src/lib/mcp/route-key.ts";

const step = PROVISION_STEPS.find((s) => s.name === "secure-auth-and-mcp")!;
const ctx = { subdomain: "acme", envPrefix: "ACME", displayName: "Acme", adminEmail: "a@x.invalid", region: "us-east-1", dryRun: false };

function fakes(opts: {
  auth: Record<string, unknown>;
  hash: string | null;
  secret?: string;
  env?: Record<string, string>;
}) {
  let state: Record<string, unknown> = { subdomain: "acme", projectRef: "ref123", serviceKey: "sb_secret_acme", mcpRouteSecret: opts.secret };
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
  const env = { MCP_ENABLED: "true", MCP_INSTANCES: "@,promiseone", ...opts.env };
  const updateEnv = vi.fn(async (id: string, input: { value: string }) => {
    env[id as keyof typeof env] = input.value;
  });
  const lines: string[] = [];
  const deps = {
    management: { getAuthConfig: vi.fn(async () => auth), updateAuthConfig, runQuery },
    vercel: {
      // The id is the key, for the fake.
      listEnv: vi.fn(async () => Object.keys(env).map((k) => ({ id: k, key: k, target: ["production"], type: "encrypted" }))),
      readEnvValue: vi.fn(async (id: string) => env[id as keyof typeof env] ?? ""),
      updateEnv,
      createEnv: vi.fn(),
    },
    log: (l: string) => lines.push(l),
    readState: () => state,
    writeState: (_s: string, patch: Record<string, unknown>) => (state = { ...state, ...patch }),
  } as unknown as ProvisionDeps;
  return { deps, updateAuthConfig, runQuery, updateEnv, env, lines, hashNow: () => hash, state: () => state };
}

describe("secure-auth-and-mcp", () => {
  it("comes after the seed and before Vercel gets the keys", () => {
    const names = PROVISION_STEPS.map((s) => s.name);
    expect(names.indexOf("secure-auth-and-mcp")).toBe(names.indexOf("seed-data") + 1);
  });

  it("sets the auth settings, AI apps on, generates a route secret of its own, and writes its hash", async () => {
    const f = fakes({ auth: { disable_signup: false, oauth_server_enabled: false }, hash: null });
    const r = await step.execute(ctx, f.deps);
    expect(r.status).toBe("done");
    const patch = f.updateAuthConfig.mock.calls[0][1];
    expect(patch).toEqual(desiredAuthConfig("acme"));
    // AI apps on by default (Jason, 2026-10-14).
    expect(patch).toMatchObject({
      oauth_server_enabled: true,
      oauth_server_authorization_path: "/oauth/consent",
      oauth_server_allow_dynamic_registration: true,
      hook_custom_access_token_enabled: true,
      hook_custom_access_token_uri: "pg-functions://postgres/public/mcp_access_token_hook",
    });
    expect(f.env.MCP_INSTANCES).toBe("@,promiseone,acme");
    // Every check reported by name.
    for (const k of Object.keys(desiredAuthConfig("acme"))) {
      expect(f.lines.some((l) => l.includes(`auth ${k}`))).toBe(true);
    }
    expect(f.lines.some((l) => l.includes("MCP route key"))).toBe(true);
    expect(f.lines.some((l) => l.includes("MCP_ENABLED is on"))).toBe(true);
    const secret = f.state().mcpRouteSecret as string;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(secret).not.toContain("sb_secret_acme");
    expect(f.hashNow()).toBe(routeKeyHash(secret));
  });

  it("does nothing when all is already right", async () => {
    const secret = "a".repeat(64);
    const f = fakes({ auth: desiredAuthConfig("acme"), hash: routeKeyHash(secret), secret, env: { MCP_INSTANCES: "@,acme" } });
    const r = await step.execute(ctx, f.deps);
    expect(r.status).toBe("skipped");
    expect(f.updateAuthConfig).not.toHaveBeenCalled();
    expect(f.updateEnv).not.toHaveBeenCalled();
  });

  it("leaves an unset MCP_INSTANCES unset, and never sets MCP_ENABLED", async () => {
    const f = fakes({ auth: {}, hash: null });
    delete (f.env as Record<string, string>).MCP_INSTANCES;
    (f.env as Record<string, string>).MCP_ENABLED = "";
    await step.execute(ctx, f.deps);
    expect(f.updateEnv).not.toHaveBeenCalled();
    expect(f.lines.some((l) => l.includes("MCP_INSTANCES unset"))).toBe(true);
    expect(f.lines.some((l) => l.includes("MCP_ENABLED is not on"))).toBe(true);
  });

  it("adds an instance to MCP_INSTANCES once", () => {
    expect(withInstance("@,promiseone", "acme")).toBe("@,promiseone,acme");
    expect(withInstance("@, acme", "acme")).toBeNull();
    expect(withInstance("", "acme")).toBe("acme");
    expect(withInstance(null, "acme")).toBeNull();
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
