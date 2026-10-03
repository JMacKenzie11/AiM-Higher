import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { readConnectionSecret } from "@/lib/connections/vault";
import {
  HubSpotNotConnected,
  SEARCH_LIMIT,
  type Deal,
  type DealSearch,
  type HubSpotPipeline,
  type HubSpotReader,
} from "./hubspot-pull";

// The company's HubSpot, read with its service key from the vault (0257).
//
// The key is fetched once per reader, on the server, with the instance's
// service-role client (the only role connection_secret admits), and sent
// only to api.hubapi.com as a Bearer token. Read-only calls: the deals
// search and the deal pipelines.
//
// One page at a time, 200 deals each, with a short pause between pages:
// HubSpot's search allows a few requests a second per account, and a
// weekly pull has no reason to race it.

const API = "https://api.hubapi.com";
const PAGE = 200;
const TIMEOUT_MS = 15_000;
const PAUSE_MS = 250;

export type HubSpotReaderWithList = HubSpotReader & {
  // Every deal pipeline with its stages, for the mapping form.
  pipelines(): Promise<HubSpotPipeline[]>;
};

type RawPipeline = { id: string; label: string; stages?: Array<{ id: string; label: string }> };

function shapePipeline(p: RawPipeline): HubSpotPipeline {
  return { id: p.id, label: p.label, stages: (p.stages ?? []).map((s) => ({ id: s.id, label: s.label })) };
}

export function hubspotReader(companyId: string, fetcher: typeof fetch = fetch): HubSpotReaderWithList {
  let key: Promise<string> | null = null;
  const keyFor = () => {
    key ??= (async () => {
      const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
      const secret = await readConnectionSecret(admin, companyId, "hubspot");
      if (!secret) throw new HubSpotNotConnected();
      return secret;
    })();
    return key;
  };

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetcher(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await keyFor()}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    return res;
  }

  async function fail(res: Response, what: string): Promise<never> {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string") detail = `: ${body.message}`;
    } catch {
      // The status says enough.
    }
    throw new Error(`HubSpot refused ${what} (${res.status})${detail}`);
  }

  return {
    async pipeline(pipelineId) {
      const res = await call(`/crm/v3/pipelines/deals/${encodeURIComponent(pipelineId)}`);
      if (res.status === 404) return null;
      if (!res.ok) await fail(res, "the pipeline read");
      return shapePipeline((await res.json()) as RawPipeline);
    },

    async pipelines() {
      const res = await call("/crm/v3/pipelines/deals");
      if (!res.ok) await fail(res, "the pipelines read");
      const body = (await res.json()) as { results?: RawPipeline[] };
      return (body.results ?? []).map(shapePipeline);
    },

    async searchDeals(search: DealSearch) {
      const deals: Deal[] = [];
      let after: string | undefined;
      let total = 0;
      do {
        const res = await call("/crm/v3/objects/deals/search", {
          method: "POST",
          body: JSON.stringify({
            filterGroups: [{ filters: search.filters }],
            properties: search.properties,
            limit: PAGE,
            ...(after ? { after } : {}),
          }),
        });
        if (!res.ok) await fail(res, "the deals search");
        const body = (await res.json()) as {
          total?: number;
          results?: Array<{ properties?: Deal }>;
          paging?: { next?: { after?: string } };
        };
        total = body.total ?? 0;
        if (total > SEARCH_LIMIT) return { deals: [], total };
        for (const r of body.results ?? []) deals.push(r.properties ?? {});
        after = body.paging?.next?.after;
        if (after) await new Promise((r) => setTimeout(r, PAUSE_MS));
      } while (after);
      return { deals, total };
    },
  };
}
