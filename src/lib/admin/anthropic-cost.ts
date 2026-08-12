import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Wraps Anthropic's Admin API cost_report endpoint. Called by the
// nightly /api/cron/anthropic-cost route to pull real invoiced
// spend and store it in anthropic_daily_cost. Also exposes a read
// helper the dashboard uses.
//
// Auth: uses the admin key via x-api-key header. Anthropic's docs
// show an OAuth-bearer example, but org-scoped admin API keys
// (sk-ant-admin-...) authenticate through x-api-key just like a
// regular API key.
//
// Filtering: results are constrained to a single workspace via
// group_by=workspace_id, then filtered in code to the workspace
// specified in env. This keeps the dashboard scoped to the
// AiMHigher key only, ignoring any other keys in the org.

const ADMIN_API_BASE = "https://api.anthropic.com/v1/organizations";
const ANTHROPIC_VERSION = "2023-06-01";

type CostResult = {
  amount: string;
  currency: string | null;
  workspace_id: string | null;
  cost_type: string | null;
  model: string | null;
  token_type: string | null;
};

type CostBucket = {
  starting_at: string;
  ending_at: string;
  results: CostResult[];
};

type CostReport = {
  data: CostBucket[];
  has_more: boolean;
  next_page: string | null;
};

export type AnthropicCostConfig = {
  adminKey: string;
  workspaceId: string;
};

// Returns null if either env var is missing so the cron can log a
// clear reason and the dashboard can gracefully degrade to the
// estimator-only view.
export function readAnthropicCostConfig(): AnthropicCostConfig | null {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  if (!adminKey || !workspaceId) return null;
  return { adminKey, workspaceId };
}

export type FetchedDailyCost = {
  bucket_date: string;
  amount_cents: number;
  workspace_id: string;
};

// Fetch daily cost buckets for the last `days` days, filtered to
// the configured workspace. Anthropic returns amount as a decimal
// string in "lowest currency units" (cents); we sum per bucket
// and parseFloat, keeping fractional cents intact. Rounding
// happens at display time.
export async function fetchDailyCost(
  config: AnthropicCostConfig,
  days: number
): Promise<FetchedDailyCost[]> {
  const startingAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10) + "T00:00:00Z";

  const perDay = new Map<string, number>();
  let page: string | undefined;

  // Paginate defensively in case the org has many workspaces
  // (each bucket may have multiple rows when grouped by workspace).
  for (let i = 0; i < 20; i++) {
    const params = new URLSearchParams({
      starting_at: startingAt,
      bucket_width: "1d",
      limit: String(Math.min(days, 31)),
    });
    params.append("group_by[]", "workspace_id");
    if (page) params.set("page", page);

    const res = await fetch(`${ADMIN_API_BASE}/cost_report?${params.toString()}`, {
      headers: {
        "x-api-key": config.adminKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      // Anthropic recommends no client caching for admin queries.
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Anthropic cost_report ${res.status}: ${body.slice(0, 400)}`
      );
    }
    const json = (await res.json()) as CostReport;

    for (const bucket of json.data) {
      const day = bucket.starting_at.slice(0, 10);
      for (const r of bucket.results) {
        if (r.workspace_id !== config.workspaceId) continue;
        const amount = parseFloat(r.amount);
        if (Number.isNaN(amount)) continue;
        perDay.set(day, (perDay.get(day) ?? 0) + amount);
      }
    }
    if (!json.has_more || !json.next_page) break;
    page = json.next_page;
  }

  return Array.from(perDay.entries())
    .map(([bucket_date, amount_cents]) => ({
      bucket_date,
      amount_cents,
      workspace_id: config.workspaceId,
    }))
    .sort((a, b) => a.bucket_date.localeCompare(b.bucket_date));
}

// Upsert one row per day, replacing any existing amount for that
// day. Anthropic re-issues yesterday's numbers if a request lands
// late, so overwriting is the correct semantic.
export async function upsertDailyCost(
  rows: FetchedDailyCost[]
): Promise<{ inserted: number }> {
  if (rows.length === 0) return { inserted: 0 };
  const admin = createSupabaseAdminClient();
  const payload = rows.map((r) => ({
    bucket_date: r.bucket_date,
    amount_cents: r.amount_cents,
    workspace_id: r.workspace_id,
    fetched_at: new Date().toISOString(),
  }));
  const { error } = await admin
    .from("anthropic_daily_cost")
    .upsert(payload, { onConflict: "bucket_date" });
  if (error) throw new Error(`upsert anthropic_daily_cost: ${error.message}`);
  return { inserted: rows.length };
}

// Dashboard read: 7d and 30d totals plus a 30-day ridge (with
// missing days zero-filled so the sparkline draws smoothly). Sums
// numeric amount_cents and rounds to whole cents at the boundary.
export type AnthropicCostSummary = {
  configured: boolean;
  totalCents7d: number;
  totalCents30d: number;
  byDay: Array<{ date: string; cents: number }>;
  latestBucketDate: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function readAnthropicCostSummary(): Promise<AnthropicCostSummary> {
  const configured = readAnthropicCostConfig() !== null;
  const admin = createSupabaseAdminClient();
  const since30 = new Date(Date.now() - 30 * DAY_MS)
    .toISOString()
    .slice(0, 10);

  const { data } = await admin
    .from("anthropic_daily_cost")
    .select("bucket_date, amount_cents")
    .gte("bucket_date", since30)
    .order("bucket_date", { ascending: true });
  const rows = (data ?? []) as Array<{
    bucket_date: string;
    amount_cents: number;
  }>;

  const byDate = new Map<string, number>();
  for (const r of rows) {
    byDate.set(r.bucket_date, Number(r.amount_cents));
  }

  const days: Array<{ date: string; cents: number }> = [];
  const cutoff7 = new Date(Date.now() - 7 * DAY_MS).toISOString().slice(0, 10);
  let totalCents30d = 0;
  let totalCents7d = 0;
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    const cents = Math.round(byDate.get(d) ?? 0);
    days.push({ date: d, cents });
    totalCents30d += cents;
    if (d >= cutoff7) totalCents7d += cents;
  }

  const latestBucketDate =
    rows.length > 0 ? rows[rows.length - 1].bucket_date : null;

  return {
    configured,
    totalCents7d,
    totalCents30d,
    byDay: days,
    latestBucketDate,
  };
}
