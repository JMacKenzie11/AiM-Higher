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

// "All time" filter — used by the Reset button on the card so
// a sysadmin can see every coaching conversation ever, without
// having to remember when the platform launched. 2020-01-01 is
// safely before any real data; end is today.
export function everythingInsightsFilters(): CoachingInsightsFilters {
  const end = new Date();
  return {
    companyIds: [],
    startIso: "2020-01-01",
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

  // Convos in the window, scoped to the filter. Always constrain
  // to scopedCompanyIds so soft-deleted tenants can't leak into
  // the counts — otherwise companiesActive can exceed
  // companiesInScope (bug: "across 9 of 8 companies") when an old
  // chat belongs to a since-deleted tenant.
  const convoQuery = admin
    .from("coaching_conversations")
    .select("id, company_id, practice_id, created_by, created_at")
    .gte("created_at", startTs)
    .lt("created_at", endTs)
    .in("company_id", scopedCompanyIds);
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

// ---- Pass 2 + 3 synthesis ---------------------------------
// Reads the per-conversation LLM analyses produced by
// /api/cron/coaching-insights and aggregates them in JS. No
// LLM call at read time — the nightly job did the expensive
// work; this layer just filters + counts + cross-tabs.

export type ThemeRow = {
  label: string;
  count: number;
  // Up to three PII-stripped one-liners drawn from the underlying
  // analyses so a reader can see WHAT leaders were saying under
  // this theme, not just a bar-chart label.
  examples: string[];
};

export type FrictionRow = {
  label: string;
  count: number;
  // Highest observed friction_level for this signal (1..3), so the
  // UI can tint the row's chip.
  level: 1 | 2 | 3;
  examples: string[];
};

export type OpportunityRow = {
  label: string;
  count: number;
  // Sample summary sentence for context.
  example: string;
};

// One cell of the practice × theme cross-tab. A null practiceId
// means Ask Aimee (no agent attached).
export type HeatmapCell = {
  practiceId: string | null;
  practiceTitle: string;
  themeLabel: string;
  count: number;
};

export type CoachingInsightsSynthesis = {
  window: CoachingInsightsWindow;
  // How many analyses fed this synthesis. If < 3 the panes render
  // an "insufficient data" state rather than misleading clusters.
  analysesCount: number;
  themes: ThemeRow[];
  friction: FrictionRow[];
  opportunities: OpportunityRow[];
  heatmap: {
    practices: Array<{ practiceId: string | null; practiceTitle: string }>;
    themes: string[];
    cells: HeatmapCell[];
  };
  // Freshness — the most recent analysis timestamp in the set.
  // The UI shows this so a sysadmin knows how caught-up the
  // nightly job is.
  lastAnalyzedAt: string | null;
};

type AnalysisRow = {
  conversation_id: string;
  company_id: string;
  practice_id: string | null;
  summary: string;
  topics: string[] | null;
  friction_level: number;
  friction_signal: string | null;
  opportunity: string | null;
  analyzed_at: string;
};

const MAX_THEMES = 8;
const MAX_FRICTION = 6;
const MAX_OPPORTUNITIES = 6;
const HEATMAP_TOP_THEMES = 5;

export async function getCoachingInsightsSynthesis(
  filters: CoachingInsightsFilters
): Promise<CoachingInsightsSynthesis> {
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

  // Everything below is best-effort: if the analyses table isn't
  // there yet (migration not applied), if the schema drifted, or
  // if Supabase errors, the dashboard should render with empty
  // synthesis panes rather than 500 the whole page. Errors are
  // logged so we notice, but never propagated.
  try {
    const admin = createSupabaseAdminClient();

    // The analyses table is keyed by conversation, but the window
    // filter belongs to the conversation's created_at, not to
    // analyzed_at. Join server-side by pulling the matching convo
    // ids first, then hydrating analyses. Constrain to live
    // companies (or the explicit filter subset) so orphan chats
    // on soft-deleted tenants stay out of the synthesis.
    const { data: liveCompanies } = await admin
      .from("companies")
      .select("id")
      .is("deleted_at", null);
    const everyCompanyId = ((liveCompanies ?? []) as Array<{ id: string }>).map(
      (c) => c.id
    );
    const scopedCompanyIds =
      filters.companyIds.length > 0 ? filters.companyIds : everyCompanyId;
    if (scopedCompanyIds.length === 0) {
      return emptySynthesis(filters, days);
    }
    const convoQuery = admin
      .from("coaching_conversations")
      .select("id")
      .gte("created_at", startTs)
      .lt("created_at", endTs)
      .in("company_id", scopedCompanyIds);
    const { data: convosData, error: convosErr } = await convoQuery;
    if (convosErr) {
      console.error("getCoachingInsightsSynthesis: convo query failed", convosErr);
      return emptySynthesis(filters, days);
    }
    const convoIds = ((convosData ?? []) as Array<{ id: string }>).map(
      (c) => c.id
    );

    if (convoIds.length === 0) {
      return emptySynthesis(filters, days);
    }

    const { data: rowsData, error: rowsErr } = await admin
      .from("coaching_conversation_analyses")
      .select(
        "conversation_id, company_id, practice_id, summary, topics, friction_level, friction_signal, opportunity, analyzed_at"
      )
      .in("conversation_id", convoIds);
    if (rowsErr) {
      console.error("getCoachingInsightsSynthesis: analyses query failed", rowsErr);
      return emptySynthesis(filters, days);
    }
    const rows = (rowsData ?? []) as AnalysisRow[];

    if (rows.length === 0) {
      return emptySynthesis(filters, days);
    }

    return buildSynthesis(rows, filters, days);
  } catch (err) {
    console.error("getCoachingInsightsSynthesis: unexpected failure", err);
    return emptySynthesis(filters, days);
  }
}

function buildSynthesis(
  rows: AnalysisRow[],
  filters: CoachingInsightsFilters,
  days: number
): CoachingInsightsSynthesis {

  // ---- Themes: normalize + bucket topics --------------------
  const themeBuckets = new Map<
    string,
    { label: string; count: number; examples: string[] }
  >();
  for (const row of rows) {
    const topics = (row.topics ?? []).filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0
    );
    // De-dupe topics inside a single row — a row shouldn't get
    // double-credit for the same theme.
    const seen = new Set<string>();
    for (const raw of topics) {
      const norm = normalizeLabel(raw);
      if (seen.has(norm)) continue;
      seen.add(norm);
      const bucket = themeBuckets.get(norm) ?? {
        label: prettifyLabel(raw),
        count: 0,
        examples: [],
      };
      bucket.count += 1;
      if (bucket.examples.length < 3 && !bucket.examples.includes(row.summary)) {
        bucket.examples.push(row.summary);
      }
      themeBuckets.set(norm, bucket);
    }
  }
  const themes: ThemeRow[] = Array.from(themeBuckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_THEMES);

  // ---- Friction: only rows with level >= 1, group by signal ---
  const frictionBuckets = new Map<
    string,
    { label: string; count: number; level: 1 | 2 | 3; examples: string[] }
  >();
  for (const row of rows) {
    if (row.friction_level < 1) continue;
    const signal = row.friction_signal?.trim();
    if (!signal) continue;
    const norm = normalizeLabel(signal);
    const level = Math.min(3, Math.max(1, row.friction_level)) as 1 | 2 | 3;
    const bucket = frictionBuckets.get(norm) ?? {
      label: prettifyLabel(signal),
      count: 0,
      level,
      examples: [],
    };
    bucket.count += 1;
    if (level > bucket.level) bucket.level = level;
    if (bucket.examples.length < 3 && !bucket.examples.includes(row.summary)) {
      bucket.examples.push(row.summary);
    }
    frictionBuckets.set(norm, bucket);
  }
  const friction: FrictionRow[] = Array.from(frictionBuckets.values())
    .sort((a, b) => b.count - a.count || b.level - a.level)
    .slice(0, MAX_FRICTION);

  // ---- Opportunities: group by phrase ----------------------
  const opportunityBuckets = new Map<
    string,
    { label: string; count: number; example: string }
  >();
  for (const row of rows) {
    const opp = row.opportunity?.trim();
    if (!opp) continue;
    const norm = normalizeLabel(opp);
    const bucket = opportunityBuckets.get(norm) ?? {
      label: prettifyLabel(opp),
      count: 0,
      example: row.summary,
    };
    bucket.count += 1;
    opportunityBuckets.set(norm, bucket);
  }
  const opportunities: OpportunityRow[] = Array.from(
    opportunityBuckets.values()
  )
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_OPPORTUNITIES);

  // ---- Heatmap: practice × top-N theme cross-tab ------------
  const topThemeLabels = themes.slice(0, HEATMAP_TOP_THEMES).map((t) => t.label);
  const topThemeSet = new Set(topThemeLabels.map((t) => normalizeLabel(t)));

  // Practice ordering by total volume so the busiest agent sits
  // on top. Ask Aimee (no practice) is included as a null id.
  const practiceCounts = new Map<string | null, number>();
  for (const row of rows) {
    practiceCounts.set(
      row.practice_id,
      (practiceCounts.get(row.practice_id) ?? 0) + 1
    );
  }
  const practices = Array.from(practiceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([pid]) => ({
      practiceId: pid,
      practiceTitle:
        pid === null
          ? "Ask Aimee"
          : findPractice(pid)?.title ?? pid,
    }));

  const cellMap = new Map<string, HeatmapCell>();
  for (const row of rows) {
    const topics = (row.topics ?? []).filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0
    );
    const seenTopics = new Set<string>();
    for (const raw of topics) {
      const norm = normalizeLabel(raw);
      if (!topThemeSet.has(norm)) continue;
      if (seenTopics.has(norm)) continue;
      seenTopics.add(norm);
      const key = `${row.practice_id ?? "null"}::${norm}`;
      const cell = cellMap.get(key) ?? {
        practiceId: row.practice_id,
        practiceTitle:
          row.practice_id === null
            ? "Ask Aimee"
            : findPractice(row.practice_id)?.title ?? row.practice_id,
        themeLabel: prettifyLabel(raw),
        count: 0,
      };
      cell.count += 1;
      cellMap.set(key, cell);
    }
  }
  const cells = Array.from(cellMap.values());

  const lastAnalyzedAt = rows
    .map((r) => r.analyzed_at)
    .sort()
    .at(-1) ?? null;

  return {
    window: { startIso: filters.startIso, endIso: filters.endIso, days },
    analysesCount: rows.length,
    themes,
    friction,
    opportunities,
    heatmap: {
      practices,
      themes: topThemeLabels,
      cells,
    },
    lastAnalyzedAt,
  };
}

function emptySynthesis(
  filters: CoachingInsightsFilters,
  days: number
): CoachingInsightsSynthesis {
  return {
    window: { startIso: filters.startIso, endIso: filters.endIso, days },
    analysesCount: 0,
    themes: [],
    friction: [],
    opportunities: [],
    heatmap: { practices: [], themes: [], cells: [] },
    lastAnalyzedAt: null,
  };
}

// Cheap fold so "Accountability" and "accountability " collapse
// into one bucket without dragging in a stemmer. Presentation
// still uses the first observed spelling via prettifyLabel.
function normalizeLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function prettifyLabel(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;
  // Sentence-case the label so a lowercase-tag input reads as a
  // proper heading in the pane.
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}
