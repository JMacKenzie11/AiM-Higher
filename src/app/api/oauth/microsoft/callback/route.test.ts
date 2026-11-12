import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Route tests for the Microsoft 365 sign-in callback (0325). The same
// security-critical branch as Google's: the company comes out of a
// state value compared against a cookie in the CALLER'S OWN browser,
// so the route must re-check the caller may manage that company before
// storing a credential against it. Plus the branch Google does not
// have: a client's Microsoft admin approving AiMS HQ, who has no AiMS
// session and must reach a thank-you page with nothing written.

const mocks = vi.hoisted(() => {
  const cookieStore = new Map<string, string>();
  const requireProfile = vi.fn();
  const exchange = vi.fn();
  return { cookieStore, requireProfile, exchange };
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

vi.mock("@/lib/connections/microsoft", () => ({
  exchangeMicrosoftCodeAndPersist: mocks.exchange,
  needsAdminApproval: (text: string | null | undefined) =>
    /AADSTS(65001|90094|90008)|admin approval|consent_required/i.test(text ?? ""),
}));

vi.mock("@/lib/supabase/env", () => ({
  APP_URL: () => "http://localhost:3200",
}));

const CO_ACME = "co_acme";
const CO_OTHER = "co_other";
const COOKIE = "microsoft_oauth_state";

function request(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3200/api/oauth/microsoft/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function session(role: string, companyId: string | null, guides: string[] = []) {
  return {
    userId: "u1",
    email: "u@example.com",
    profile: { id: "u1", role, company_id: companyId, guide_company_ids: guides, portfolio_admin_company_ids: [] },
  };
}

describe("GET /api/oauth/microsoft/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieStore.clear();
    mocks.exchange.mockResolvedValue("jon@client.com");
  });

  it("stores the credential for a company_admin's own company", async () => {
    mocks.requireProfile.mockResolvedValue(session("company_admin", CO_ACME));
    mocks.cookieStore.set(COOKIE, `nonce.${CO_ACME}`);
    const { GET } = await import("./route");

    const res = await GET(request({ code: "c1", state: `nonce.${CO_ACME}` }));

    expect(mocks.exchange).toHaveBeenCalledWith("c1", CO_ACME, "u1");
    expect(res.headers.get("location")).toBe(
      `http://localhost:3200/admin/companies/${CO_ACME}?ms_connected=jon%40client.com#connections`
    );
  });

  it("refuses to bind a credential to a company the caller does not admin", async () => {
    mocks.requireProfile.mockResolvedValue(session("company_admin", CO_ACME));
    mocks.cookieStore.set(COOKIE, `nonce.${CO_OTHER}`);
    const { GET } = await import("./route");

    const res = await GET(request({ code: "c1", state: `nonce.${CO_OTHER}` }));

    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("http://localhost:3200/admin/companies?ms_error=forbidden");
  });

  it("refuses a state that doesn't match the cookie", async () => {
    mocks.requireProfile.mockResolvedValue(session("system_admin", null));
    mocks.cookieStore.set(COOKIE, `nonce.${CO_ACME}`);
    const { GET } = await import("./route");

    const res = await GET(request({ code: "c1", state: `tampered.${CO_ACME}` }));

    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("http://localhost:3200/admin/companies?ms_error=invalid_state");
  });

  it("returns 403 for roles that can't manage connections at all", async () => {
    mocks.requireProfile.mockResolvedValue(session("team_member", CO_ACME));
    const { GET } = await import("./route");

    const res = await GET(request({ code: "c1", state: `nonce.${CO_ACME}` }));

    expect(res.status).toBe(403);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("sends a person whose organisation hasn't approved AiMS HQ to the admin's link", async () => {
    mocks.requireProfile.mockResolvedValue(session("company_admin", CO_ACME));
    mocks.cookieStore.set(COOKIE, `nonce.${CO_ACME}`);
    const { GET } = await import("./route");

    const res = await GET(
      request({
        state: `nonce.${CO_ACME}`,
        error: "access_denied",
        error_description: "AADSTS90094: Admin approval required.",
      })
    );

    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(
      `http://localhost:3200/admin/companies/${CO_ACME}?ms_needs_admin=1#connections`
    );
  });

  it("sends a person back from approving with Connect showing", async () => {
    mocks.requireProfile.mockResolvedValue(session("company_admin", CO_ACME));
    mocks.cookieStore.set(COOKIE, `nonce.${CO_ACME}.approve`);
    const { GET } = await import("./route");

    const res = await GET(request({ admin_consent: "True", tenant: "t1", state: `nonce.${CO_ACME}.approve` }));

    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(
      `http://localhost:3200/admin/companies/${CO_ACME}?ms_approved=1#connections`
    );
  });

  it("says so when the approval didn't happen (usually not an admin account)", async () => {
    mocks.requireProfile.mockResolvedValue(session("company_admin", CO_ACME));
    mocks.cookieStore.set(COOKIE, `nonce.${CO_ACME}.approve`);
    const { GET } = await import("./route");

    const res = await GET(
      request({ error: "access_denied", error_description: "AADSTS90094", state: `nonce.${CO_ACME}.approve` })
    );

    expect(res.headers.get("location")).toBe(
      `http://localhost:3200/admin/companies/${CO_ACME}?ms_not_approved=1#connections`
    );
  });

  it("ignores an approval whose state doesn't match the cookie", async () => {
    mocks.requireProfile.mockResolvedValue(session("company_admin", CO_ACME));
    mocks.cookieStore.set(COOKIE, `nonce.${CO_ACME}.approve`);
    const { GET } = await import("./route");

    const res = await GET(request({ admin_consent: "True", state: `forged.${CO_ACME}.approve` }));

    expect(res.headers.get("location")).toBe("http://localhost:3200/admin/companies?ms_error=invalid_state");
  });
});
