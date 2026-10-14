import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import type { RecentCounts } from "./limits";

// THE ACTION LOG (assistant_actions, 0273), written and counted with the
// service role. That is the one thing the service role does in the MCP
// server, and it is our bookkeeping, not anything the assistant asked
// for: every read an assistant asks for runs on its own token, as the
// person, through RLS and the allow list. A log the logged token could
// write would not be a log, which is why it is not the token.
//
// Never the token, headers, arguments or results: who, which company,
// which assistant, which tool, the outcome, a short reason code, how
// many rows and how long.

export type ActionRecord = {
  profileId: string;
  companyId: string | null;
  clientId: string;
  tool: string;
  outcome: "ok" | "refused" | "error" | "rate_limited";
  reason?: string | null;
  rowCount?: number | null;
  durationMs?: number | null;
};

export async function recordAction(record: ActionRecord): Promise<void> {
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error } = await admin.from("assistant_actions").insert({
    profile_id: record.profileId,
    company_id: record.companyId,
    client_id: record.clientId,
    tool: record.tool,
    outcome: record.outcome,
    reason: record.reason ?? null,
    row_count: record.rowCount ?? null,
    duration_ms: record.durationMs ?? null,
  });
  // A failed log line must not fail the person's request, and must not
  // vanish either. The message carries no token or argument.
  if (error) console.error(`assistant_actions insert failed: ${error.code ?? ""} ${error.message}`);
}

async function countSince(column: "profile_id" | "company_id", id: string, since: Date): Promise<number> {
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { count, error } = await admin
    .from("assistant_actions")
    .select("id", { count: "exact", head: true })
    .eq(column, id)
    .gte("created_at", since.toISOString());
  // Unable to count is treated as at the limit: refusing a call is
  // recoverable, and an unlimited assistant is the thing the limit is for.
  if (error) return Number.MAX_SAFE_INTEGER;
  return count ?? 0;
}

export async function recentCounts(column: "profile_id" | "company_id", id: string): Promise<RecentCounts> {
  const now = Date.now();
  const [lastMinute, lastHour] = await Promise.all([
    countSince(column, id, new Date(now - 60_000)),
    countSince(column, id, new Date(now - 3_600_000)),
  ]);
  return { lastMinute, lastHour };
}
