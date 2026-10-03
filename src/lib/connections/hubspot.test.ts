import { describe, it, expect, vi } from "vitest";
import { checkHubSpotKey, keyHint, keyShapeProblem } from "./hubspot";

vi.mock("server-only", () => ({}));

const KEY = "pat-na1-0123456789abcdef0123456789abcdef";

// A HubSpot that answers each path with a status.
function hubspot(answers: Record<string, number>, portalId: number | null = 12345) {
  return vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    const status = answers[path] ?? 200;
    if (status === -1) throw new Error("network down");
    const body = path === "/account-info/v3/details" && portalId !== null ? { portalId } : {};
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe("checkHubSpotKey", () => {
  it("accepts a key that reads deals and their properties, and names the account", async () => {
    const fetcher = hubspot({});
    expect(await checkHubSpotKey(KEY, fetcher)).toEqual({
      ok: true,
      scopes: ["crm.objects.deals.read", "crm.schemas.deals.read"],
      accountLabel: "HubSpot account 12345",
    });
    const calls = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
    expect(calls.map(([u]) => new URL(u).hostname)).toEqual(["api.hubapi.com", "api.hubapi.com", "api.hubapi.com"]);
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it("refuses a key HubSpot does not accept", async () => {
    const r = await checkHubSpotKey(KEY, hubspot({ "/crm/v3/objects/deals": 401 }));
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/did not accept that key/) });
  });

  it("names the missing scope, in HubSpot's own terms", async () => {
    expect(await checkHubSpotKey(KEY, hubspot({ "/crm/v3/objects/deals": 403 }))).toMatchObject({
      ok: false,
      message: expect.stringContaining("crm.objects.deals.read"),
    });
    expect(await checkHubSpotKey(KEY, hubspot({ "/crm/v3/properties/deals": 403 }))).toMatchObject({
      ok: false,
      message: expect.stringContaining("crm.schemas.deals.read"),
    });
  });

  it("says HubSpot could not be reached rather than calling the key bad", async () => {
    expect(await checkHubSpotKey(KEY, hubspot({ "/crm/v3/objects/deals": -1 }))).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Couldn't reach HubSpot/),
    });
  });

  it("keeps a working key when the account details are not readable", async () => {
    expect(await checkHubSpotKey(KEY, hubspot({ "/account-info/v3/details": 403 }))).toMatchObject({ ok: true, accountLabel: null });
  });
});

describe("keyShapeProblem and keyHint", () => {
  it("refuses an empty key, one with a space or a break, and a fragment", () => {
    expect(keyShapeProblem("")).toMatch(/Paste the key/);
    expect(keyShapeProblem(`${KEY} more`)).toMatch(/space or a line break/);
    expect(keyShapeProblem("pat-na1-short")).toMatch(/whole HubSpot key/);
    expect(keyShapeProblem(KEY)).toBeNull();
  });

  it("shows only the last four characters", () => {
    expect(keyHint(KEY)).toBe("cdef");
  });
});
