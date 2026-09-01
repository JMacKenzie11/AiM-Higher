import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Route tests for the Google OAuth callback. The security-critical
// branch: the company id is parsed out of the `state` value, which
// is compared against a cookie in the CALLER'S OWN browser. A
// company_admin can rewrite that cookie, walk through Google's
// consent screen with state=x.<victimCompany>, and land here with
// a matching pair. /start checked membership before minting the
// cookie; this route must re-check before persisting the credential
// against the company, or the caller binds their Google account to
// another tenant's Drive ingest.

const mocks = vi.hoisted(() => {
  const cookieStore = new Map<string, string>();
  const requireProfile = vi.fn();
  const exchangeCodeAndPersist = vi.fn();
  return { cookieStore, requireProfile, exchangeCodeAndPersist };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookieStore.get(name);
      return value !== undefined ? { name, value } : undefined;
    },
    delete: (name: string) => {
      mocks.cookieStore.delete(name);
    },
    set: (name: string, value: string) => {
      mocks.cookieStore.set(name, value);
    },
  }),
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: mocks.requireProfile,
}));

vi.mock("@/lib/transcripts/providers/google-drive", () => ({
  exchangeCodeAndPersist: mocks.exchangeCodeAndPersist,
}));

vi.mock("@/lib/supabase/env", () => ({
  APP_URL: () => "http://localhost:3200",
}));

const CO_ACME = "co_acme";
const CO_OTHER = "co_other";

function callbackRequest(state: string, code = "auth_code"): NextRequest {
  const url = new URL("http://localhost:3200/api/oauth/google/callback");
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);
  return new NextRequest(url);
}

function session(role: string, companyId: string | null, guides: string[] = []) {
  return {
    userId: "u1",
    email: "u@example.com",
    profile: {
      id: "u1",
      role,
      company_id: companyId,
      guide_company_ids: guides,
    },
  };
}

describe("GET /api/oauth/google/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieStore.clear();
    mocks.exchangeCodeAndPersist.mockResolvedValue("ops@example.com");
  });

  it("refuses to bind a credential to a company the caller does not admin", async () => {
    // state matches the (attacker-controlled) cookie, so the CSRF
    // check passes. The membership check is what must stop this.
    mocks.requireProfile.mockResolvedValue(session("company_admin", CO_ACME));
    const state = `nonce.${CO_OTHER}`;
    mocks.cookieStore.set("google_oauth_state", state);
    const { GET } = await import("./route");

    const res = await GET(callbackRequest(state));

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3200/admin/companies?oauth_error=forbidden"
    );
    expect(mocks.exchangeCodeAndPersist).not.toHaveBeenCalled();
  });

  it("refuses an aims_guide for a company outside their assignments", async () => {
    mocks.requireProfile.mockResolvedValue(
      session("aims_guide", null, [CO_ACME])
    );
    const state = `nonce.${CO_OTHER}`;
    mocks.cookieStore.set("google_oauth_state", state);
    const { GET } = await import("./route");

    const res = await GET(callbackRequest(state));

    expect(res.headers.get("location")).toBe(
      "http://localhost:3200/admin/companies?oauth_error=forbidden"
    );
    expect(mocks.exchangeCodeAndPersist).not.toHaveBeenCalled();
  });

  it("persists the credential for a company_admin's own company", async () => {
    mocks.requireProfile.mockResolvedValue(session("company_admin", CO_ACME));
    const state = `nonce.${CO_ACME}`;
    mocks.cookieStore.set("google_oauth_state", state);
    const { GET } = await import("./route");

    const res = await GET(callbackRequest(state));

    expect(mocks.exchangeCodeAndPersist).toHaveBeenCalledWith(
      "auth_code",
      CO_ACME
    );
    expect(res.headers.get("location")).toBe(
      `http://localhost:3200/admin/companies/${CO_ACME}?oauth_connected=ops%40example.com`
    );
  });

  it("lets a system_admin connect any company", async () => {
    mocks.requireProfile.mockResolvedValue(session("system_admin", null));
    const state = `nonce.${CO_OTHER}`;
    mocks.cookieStore.set("google_oauth_state", state);
    const { GET } = await import("./route");

    await GET(callbackRequest(state));

    expect(mocks.exchangeCodeAndPersist).toHaveBeenCalledWith(
      "auth_code",
      CO_OTHER
    );
  });

  it("still rejects a state that doesn't match the cookie", async () => {
    mocks.requireProfile.mockResolvedValue(session("system_admin", null));
    mocks.cookieStore.set("google_oauth_state", `nonce.${CO_ACME}`);
    const { GET } = await import("./route");

    const res = await GET(callbackRequest(`tampered.${CO_ACME}`));

    expect(res.headers.get("location")).toBe(
      "http://localhost:3200/admin/companies?oauth_error=invalid_state"
    );
    expect(mocks.exchangeCodeAndPersist).not.toHaveBeenCalled();
  });

  it("returns 403 for roles that can't manage transcript sources at all", async () => {
    mocks.requireProfile.mockResolvedValue(session("team_member", CO_ACME));
    const { GET } = await import("./route");

    const res = await GET(callbackRequest(`nonce.${CO_ACME}`));

    expect(res.status).toBe(403);
    expect(mocks.exchangeCodeAndPersist).not.toHaveBeenCalled();
  });
});
