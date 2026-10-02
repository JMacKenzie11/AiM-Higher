import { describe, it, expect, beforeEach, vi } from "vitest";

// The Connections page's writes: only a company's admins, only with the
// feature, and a key HubSpot refuses is never stored.

const mocks = vi.hoisted(() => ({
  profile: { id: "u1", role: "company_admin", company_id: "co1" } as Record<string, unknown>,
  feature: true,
  check: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/current-user", () => ({ requireProfile: async () => ({ profile: mocks.profile }) }));
vi.mock("@/lib/subscriptions/service", () => ({ companyHasFeature: async () => mocks.feature }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("./hubspot", async (orig) => ({ ...(await orig<typeof import("./hubspot")>()), checkHubSpotKey: mocks.check }));

import { removeConnectionAction, saveHubSpotKeyAction } from "./actions";

const KEY = "pat-na1-0123456789abcdef0123456789abcdef";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile = { id: "u1", role: "company_admin", company_id: "co1" };
  mocks.feature = true;
  mocks.check.mockResolvedValue({ ok: true, scopes: ["crm.objects.deals.read", "crm.schemas.deals.read"], accountLabel: "HubSpot account 1" });
  mocks.rpc.mockResolvedValue({ data: "conn1", error: null });
});

describe("saveHubSpotKeyAction", () => {
  it("checks the key with HubSpot, then saves it under the caller's session with only its last four for the page", async () => {
    const r = await saveHubSpotKeyAction("co1", `  ${KEY}  `);
    expect(r).toEqual({ ok: true, message: expect.stringMatching(/^Saved/) });
    expect(mocks.check).toHaveBeenCalledWith(KEY);
    expect(mocks.rpc).toHaveBeenCalledWith("connection_put", {
      p_company_id: "co1",
      p_connector: "hubspot",
      p_secret: KEY,
      p_hint: "cdef",
      p_account_label: "HubSpot account 1",
      p_scopes: ["crm.objects.deals.read", "crm.schemas.deals.read"],
    });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("stores nothing when HubSpot refuses the key", async () => {
    mocks.check.mockResolvedValue({ ok: false, message: "HubSpot did not accept that key." });
    expect(await saveHubSpotKeyAction("co1", KEY)).toEqual({ ok: false, message: "HubSpot did not accept that key." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses another company's admin, a team member, and a company without the feature, before HubSpot hears the key", async () => {
    expect((await saveHubSpotKeyAction("co2", KEY)).ok).toBe(false);
    mocks.profile = { id: "u2", role: "team_member", company_id: "co1" };
    expect((await saveHubSpotKeyAction("co1", KEY)).ok).toBe(false);
    mocks.profile = { id: "u1", role: "company_admin", company_id: "co1" };
    mocks.feature = false;
    expect((await saveHubSpotKeyAction("co1", KEY)).ok).toBe(false);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a key that is not one whole key, before HubSpot hears it", async () => {
    expect((await saveHubSpotKeyAction("co1", "not a key")).ok).toBe(false);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("admits a portfolio admin switched on for the company, and not one only assigned to it", async () => {
    mocks.profile = { id: "p1", role: "portfolio_admin", company_id: null, portfolio_admin_company_ids: ["co1"] };
    expect((await saveHubSpotKeyAction("co1", KEY)).ok).toBe(true);
    mocks.profile = { id: "p1", role: "portfolio_admin", company_id: null, portfolio_admin_company_ids: [] };
    expect((await saveHubSpotKeyAction("co1", KEY)).ok).toBe(false);
  });
});

describe("removeConnectionAction", () => {
  it("removes through connection_remove, and says so", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect(await removeConnectionAction("co1", "hubspot")).toEqual({ ok: true, message: "Disconnected. The key is deleted." });
    expect(mocks.rpc).toHaveBeenCalledWith("connection_remove", { p_company_id: "co1", p_connector: "hubspot" });
  });

  it("passes on the database's refusal in plain words", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "x" } });
    expect(await removeConnectionAction("co1", "google")).toEqual({ ok: false, message: "Only this company's admins can manage its connections." });
  });
});
