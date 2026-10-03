import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: async () => ({}) }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
const secret = vi.hoisted(() => ({ value: "pat-na1-key" as string | null }));
vi.mock("@/lib/connections/vault", () => ({ readConnectionSecret: async () => secret.value }));

import { hubspotReader } from "./hubspot-reader";
import { HubSpotNotConnected } from "./hubspot-pull";

function respond(handler: (path: string, body: unknown) => { status: number; body: unknown }) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const r = handler(u.pathname, init?.body ? JSON.parse(String(init.body)) : null);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
}

describe("hubspotReader", () => {
  it("pages through the search with the key from the vault, and only to HubSpot", async () => {
    secret.value = "pat-na1-key";
    const fetcher = respond((_path, body) => {
      const after = (body as { after?: string }).after;
      return after
        ? { status: 200, body: { total: 3, results: [{ properties: { amount_in_home_currency: "3" } }] } }
        : { status: 200, body: { total: 3, results: [{ properties: { amount_in_home_currency: "1" } }, { properties: { amount_in_home_currency: "2" } }], paging: { next: { after: "2" } } } };
    });
    const r = await hubspotReader("co1", fetcher).searchDeals({ filters: [], properties: ["amount_in_home_currency"] });
    expect(r).toEqual({ total: 3, deals: [{ amount_in_home_currency: "1" }, { amount_in_home_currency: "2" }, { amount_in_home_currency: "3" }] });
    const calls = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [url, init] of calls) {
      expect(new URL(url).hostname).toBe("api.hubapi.com");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pat-na1-key");
    }
  });

  it("reads a pipeline's stages, and says when HubSpot has no such pipeline", async () => {
    const fetcher = respond((path) =>
      path.endsWith("/default")
        ? { status: 200, body: { id: "default", label: "Sales", stages: [{ id: "closedwon", label: "Closed won", metadata: {} }] } }
        : { status: 404, body: {} }
    );
    const reader = hubspotReader("co1", fetcher);
    expect(await reader.pipeline("default")).toEqual({ id: "default", label: "Sales", stages: [{ id: "closedwon", label: "Closed won" }] });
    expect(await reader.pipeline("gone")).toBeNull();
  });

  it("passes on HubSpot's own words when it refuses", async () => {
    const fetcher = respond(() => ({ status: 401, body: { message: "Authentication credentials not found." } }));
    await expect(hubspotReader("co1", fetcher).pipelines()).rejects.toThrow("HubSpot refused the pipelines read (401): Authentication credentials not found.");
  });

  it("says the company has no key, without calling HubSpot", async () => {
    secret.value = null;
    const fetcher = respond(() => ({ status: 200, body: {} }));
    await expect(hubspotReader("co1", fetcher).pipelines()).rejects.toBeInstanceOf(HubSpotNotConnected);
    expect(fetcher).not.toHaveBeenCalled();
    secret.value = "pat-na1-key";
  });
});
