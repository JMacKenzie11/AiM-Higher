import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findPractice } from "@/lib/practices/registry";

// Cross-company coaching-insights layer. Feeds the "Coaching
// insights" card at the bottom of /admin/dashboard.
//
// Pass 1 (this file) is deterministic SQL only — no LLM. Returns
// the adoption/volume slice for a caller-supplied filter (company
// multi + date range). Later passes will layer on top:
//   - Pass 2: per-conversation summaries (LLM) + theme clusters +
//     friction signals.
//   - Pass 3: product-opportunity synthesis + agent×category
//     heatmap.
//
// Every read uses the admin Supabase client because the caller is
// always a system_admin (route enforces) and the data is
// intentionally cross-tenant. RLS on coaching_conversations would
// scope us to the sysadmin's own threads otherwise.

export type CoachingInsightsFilters = {
  // Empty array = every company. Non-empty = restrict to these
  // ids. UI treats "no companies selected" as an implicit "all".
  companyIds: string[];
  // ISO date strings (YYYY-MM-DD). Both required. Inclusive on
  // start; end is the last day the filter covers (converted to
  // an exclusive upper bound internally at start-of-next-day).
  startIso: string;
  endIso: string;
};

export type CoachingInsightsWindow = {
  startIso: string;
  endIso: string;
  days: number;
};

export type AgentAdoptionRow = {
  agentId: string | null; // null = plain Ask Aimee
  title: string;
  count: number;
  wentDeep: number; // conversations with 6+ messages
};

export type DailyPoint = {
  date: string; // YYYY-MM-DD
  count: number;
};

export type CoachingInsightsAdoption = {
  window: CoachingInsightsWindow;
  // "Companies in scope" — the count of companies the filter
  // covers. Empty filter → all active tenants; non-empty → the
  // filter's cardinality.
  companiesInScope: number;
  companiesActive: number; // subset that had at least one convo in window
  conversations: {
    total: number;
    withUserTurn: number;
    withAgent: number;
    plainAimee: number;
  };
  uniqueUsers: number;
  averageThreadLength: number; // messages per conversation, mean
  medianThreadLength: number;
  pastThreeExchanges: { count: number; pct: number };
  topAgents: AgentAdoptionRow[];
  daily: DailyPoint[];
};

export type CompanyOption = {
  id: string;
  name: string;
};

// Default window applied when the UI first loads: last 30 days
// including today. Server-side to avoid client/server clock
// drift on the initial render.
export function defaultInsightsFilters(): CoachingInsightsFilters {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 29); // 30 days inclusive
  return {
    companyIds: [],
    startIso: start.toISOString().slice(0, 10),
    endIso: end.toISOString().slice(0, 10),
  };
}

// Companies the filter dropdown offers. Excludes soft-deleted
// rows (handled by the companies_hide_deleted policy at the DB
// layer — the admin client bypasses RLS so we filter here too as
// belt-and-braces).
export async function listCoachingInsightsCompanies(): Promise<CompanyOption[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("companies")
    .select("id, name")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  return ((data ?? []) as CompanyOption[]);
}

// Main read for the card. Every query below uses the same
// window + company filter shape so the result reads as a
// coherent slice.
export async function getCoachingInsightsAdoption(
  filters: CoachingInsightsFilters
): Promise<CoachingInsightsAdoption> {
  const admin = createSupabaseAdminClient();

  // Convert endIso (inclusive day) to an exclusive upper bound
  // at start-of-next-day so a filter ending "2026-08-31" catches
  // rows created that day right up to 23:59:59.999.
  const startTs = `${filters.startIso}T00:00:00.000Z`;
  const endExclusive = new Date(`${filters.endIso}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const endTs = endExclusive.toISOString();
  const days = Math.max(
    1,
    Math.round(
      (endExclusive.getTime() - Date.parse(startTs)) / (24 * 60 * 60 * 1000)
    )
  );

  // Resolve the company set. Empty selection = every active
  // tenant; used for both the "in-scope" denominator and the
  // convo filter below.
  const { data: allCompanies } = await admin
    .from("companies")
    .select("id")
    .is("deleted_at", null);
  const everyCompanyId = ((allCompanies ?? []) as Array<{ id: string }>).map(
    (c) => c.id
  );
  const scopedCompanyIds =
    filters.companyIds.length > 0 ? filters.companyIds : everyCompanyId;
  const companiesInScope = scopedCompanyIds.length;

  // Convos in the window, scoped to the filter. Pull only the
  // shape we need for downstream aggregation.
  let convoQuery = admin
    .from("coaching_conversations")
    .select("id, company_id, practice_id, created_by, created_at")
    .gte("created_at", startTs)
    .lt("created_at", endTs);
  if (filters.companyIds.length > 0) {
    convoQuery = convoQuery.in("company_id", filters.companyIds);
  }
  const { data: convosData } = await convoQuery;
  const convos = ((convosData ?? []) as Array<{
    id: string;
    company_id: string;
    practice_id: string | null;
    created_by: string;
    created_at: string;
  }>);

  if (convos.length === 0) {
    return {
      window: { startIso: filters.startIso, endIso: filters.endIso, days },
      companiesInScope,
      companiesActive: 0,
      conversations: {
        total: 0,
        withUserTurn: 0,
        withAgent: 0,
        plainAimee: 0,
      },
      uniqueUsers: 0,
      averageThreadLength: 0,
      medianThreadLength: 0,
      pastThreeExchanges: { count: 0, pct: 0 },
      topAgents: [],
      daily: buildDailySeries(filters.startIso, filters.endIso, new Map()),
    };
  }

  const convoIds = convos.map((c) => c.id);

  // Per-conversation message counts, split by role. One indexed
  // scan; grouped in JS since Postgres GROUP BY through PostgREST
  // requires an RPC.
  const { data: msgsData } = await admin
    .from("coaching_messages")
    .select("conversation_id, role, created_by")
    .in("conversation_id", convoIds);
  const msgs = ((msgsData ?? []) as Array<{
    conversation_id: string;
    role: "user" | "assistant";
    created_by: string;
  }>);

  const perConvo = new Map<
    string,
    { total: number; user: number; assistant: number }
  >();
  const uniqueUsersInWindow = new Set<string>();
  for (const m of msgs) {
    const cell = perConvo.get(m.conversation_id) ?? {
      total: 0,
      user: 0,
      assistant: 0,
    };
    cell.total += 1;
    if (m.role === "user") {
      cell.user += 1;
      uniqueUsersInWindow.add(m.created_by);
    } else {
      cell.assistant += 1;
    }
    perConvo.set(m.conversation_id, cell);
  }

  // Aggregate.
  let withUserTurn = 0;
  let withAgent = 0;
  let plainAimee = 0;
  let pastThreeExchanges = 0;
  const totalLengths: number[] = [];
  const activeCompanies = new Set<string>();
  const perAgent = new Map<
    string,
    { title: string; count: number; wentDeep: number }
  >();
  const dailyBuckets = new Map<string, number>();

  for (const c of convos) {
    activeCompanies.add(c.company_id);
    const cell = perConvo.get(c.id);
    const total = cell?.total ?? 0;
    totalLengths.push(total);
    if ((cell?.user ?? 0) > 0) withUserTurn += 1;
    // "Past 3 exchanges" — an exchange is user+assistant, so 6+
    // messages is a rough proxy. Practices that ship a scripted
    // opener already have an assistant turn without a user turn,
    // so 6 is still the right threshold for "we're deep in this."
    if (total >= 6) pastThreeExchanges += 1;
    if (c.practice_id) {
      withAgent += 1;
      const bucket = perAgent.get(c.practice_id) ?? {
        title:
          findPractice(c.practice_id)?.title ?? c.practice_id,
        count: 0,
        wentDeep: 0,
      };
      bucket.count += 1;
      if (total >= 6) bucket.wentDeep += 1;
      perAgent.set(c.practice_id, bucket);
    } else {
      plainAimee += 1;
    }
    const day = c.created_at.slice(0, 10);
    dailyBuckets.set(day, (dailyBuckets.get(day) ?? 0) + 1);
  }

  // Include a "plain Aimee" row in the agent breakdown so it's
  // never invisible — even if it's the largest slice, a reader
  // scanning the top agents shouldn't have to look elsewhere to
  // see how many chats had no agent attached.
  const topAgents: AgentAdoptionRow[] = [];
  if (plainAimee > 0) {
    let wentDeep = 0;
    for (const c of convos) {
      if (c.practice_id === null && (perConvo.get(c.id)?.total ?? 0) >= 6) {
        wentDeep += 1;
      }
    }
    topAgents.push({
      agentId: null,
      title: "Ask Aimee (no agent)",
      count: plainAimee,
      wentDeep,
    });
  }
  for (const [agentId, bucket] of perAgent) {
    topAgents.push({
      agentId,
      title: bucket.title,
      count: bucket.count,
      wentDeep: bucket.wentDeep,
    });
  }
  topAgents.sort((a, b) => b.count - a.count);

  return {
    window: { startIso: filters.startIso, endIso: filters.endIso, days },
    companiesInScope,
    companiesActive: activeCompanies.size,
    conversations: {
      total: convos.length,
      withUserTurn,
      withAgent,
      plainAimee,
    },
    uniqueUsers: uniqueUsersInWindow.size,
    averageThreadLength:
      totalLengths.length > 0
        ? Math.round(
            (totalLengths.reduce((s, n) => s + n, 0) / totalLengths.length) *
              10
          ) / 10
        : 0,
    medianThreadLength: median(totalLengths),
    pastThreeExchanges: {
      count: pastThreeExchanges,
      pct:
        convos.length > 0
          ? Math.round((pastThreeExchanges / convos.length) * 100)
          : 0,
    },
    topAgents,
    daily: buildDailySeries(filters.startIso, filters.endIso, dailyBuckets),
  };
}

// ---- Helpers ----------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10
    : sorted[mid];
}

// Dense series from startIso to endIso inclusive, filling zero
// on days with no conversation. A sparkline reads honestly when
// gaps in activity are visible rather than compressed away.
function buildDailySeries(
  startIso: string,
  endIso: string,
  counts: Map<string, number>
): DailyPoint[] {
  const out: DailyPoint[] = [];
  const cursor = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.toISOString().slice(0, 10);
    out.push({ date: day, count: counts.get(day) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
