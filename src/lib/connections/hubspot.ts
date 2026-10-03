import "server-only";

// CHECKING A HUBSPOT SERVICE KEY BEFORE IT IS STORED
// (external connections plan, phase 3).
//
// A company's admin pastes a HubSpot service key on the Connections
// page. Before it reaches the vault, two small reads prove it works and
// has the two read-only scopes the plan asks for:
//
//   crm.objects.deals.read    read one deal          /crm/v3/objects/deals?limit=1
//   crm.schemas.deals.read    read deal properties   /crm/v3/properties/deals
//
// A key that fails either is never stored, and the person is told which
// scope is missing in HubSpot's terms, because that is where they fix it.
// The key is sent only to api.hubapi.com, as a Bearer token, and never
// logged or returned.

const API = "https://api.hubapi.com";
const TIMEOUT_MS = 10_000;

export const HUBSPOT_SCOPES = ["crm.objects.deals.read", "crm.schemas.deals.read"] as const;

export type KeyCheck =
  | { ok: true; scopes: string[]; accountLabel: string | null }
  | { ok: false; message: string };

type Fetch = typeof fetch;

async function get(fetcher: Fetch, path: string, key: string): Promise<Response | null> {
  try {
    return await fetcher(`${API}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

// What a refused read means, in words a person can act on.
function refusal(res: Response | null, scope: string): string | null {
  if (!res) return "Couldn't reach HubSpot. Check your connection and try again.";
  if (res.ok) return null;
  if (res.status === 401) {
    return "HubSpot did not accept that key. Copy it again from HubSpot and paste the whole key.";
  }
  if (res.status === 403) {
    return `That key can't read what AiMS needs. In HubSpot, give it the ${scope} scope, then paste it again.`;
  }
  if (res.status === 429) return "HubSpot is busy right now. Wait a minute and try again.";
  return `HubSpot answered with an error (${res.status}). Try again in a few minutes.`;
}

// The portal the key belongs to, for the card. Optional: a key without
// access to the account details still works for deals, so a failure
// here leaves the label empty rather than refusing the key.
async function accountLabel(fetcher: Fetch, key: string): Promise<string | null> {
  const res = await get(fetcher, "/account-info/v3/details", key);
  if (!res?.ok) return null;
  try {
    const body = (await res.json()) as { portalId?: unknown };
    return typeof body.portalId === "number" || typeof body.portalId === "string"
      ? `HubSpot account ${body.portalId}`
      : null;
  } catch {
    return null;
  }
}

export async function checkHubSpotKey(key: string, fetcher: Fetch = fetch): Promise<KeyCheck> {
  const deals = await get(fetcher, "/crm/v3/objects/deals?limit=1", key);
  const dealsProblem = refusal(deals, "crm.objects.deals.read");
  if (dealsProblem) return { ok: false, message: dealsProblem };

  const schema = await get(fetcher, "/crm/v3/properties/deals?archived=false", key);
  const schemaProblem = refusal(schema, "crm.schemas.deals.read");
  if (schemaProblem) return { ok: false, message: schemaProblem };

  return { ok: true, scopes: [...HUBSPOT_SCOPES], accountLabel: await accountLabel(fetcher, key) };
}

// What a pasted key must look like before it is sent anywhere: one
// unbroken string of a plausible length. HubSpot's own formats change,
// so this checks shape, not prefix.
export function keyShapeProblem(key: string): string | null {
  if (!key) return "Paste the key first.";
  if (/\s/.test(key)) return "That has a space or a line break in it. Copy the key again, on its own.";
  if (key.length < 20 || key.length > 500) return "That doesn't look like a whole HubSpot key. Copy it again from HubSpot.";
  return null;
}

// The last four characters, the only part of a key the page shows.
export function keyHint(key: string): string {
  return key.slice(-4);
}
