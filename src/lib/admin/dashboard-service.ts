import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PRACTICES } from "@/lib/practices/registry";

// Cross-company aggregates for the system-admin dashboard. Every
// query here uses the admin client because they intentionally
// bypass company scoping (RLS would rightly block a regular
// server client from seeing multiple companies).
//
// The page component gates itself with requireRole(system_admin);
// this module is server-only so it can't accidentally end up in
// a client bundle. Belt and braces.
//
// Style: one small function per card on the dashboard, each
// returning a plainly-typed record the UI can render without
// further munging. Aggregations happen in JS after cheap SELECTs
// rather than complex SQL views — easier to iterate on the
// dashboard's shape as it evolves.

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

// ---- Platform pulse -------------------------------------------------

export type PlatformPulse = {
  newCompanies7d: number;
  activeUsers7d: number;
  activeUsers30d: number;
  // A "turn" is one exchange: one user message + one coach response.
  // We count assistant messages as the canonical turn count because
  // every completed turn produces exactly one assistant row (a user
  // message that never got a response would inflate a user-count).
  // A long thread of 20 exchanges therefore counts as 20 turns, not
  // 1 conversation — which is what the "engagement volume" metric
  // is meant to reflect.
  turns7d: number;
  turns30d: number;
  costUsdCents7d: number;
};

export async function getPlatformPulse(): Promise<PlatformPulse> {
  const admin = createSupabaseAdminClient();
  const since7 = daysAgo(7);
  const since30 = daysAgo(30);

  const [newCompanies, msgs7, msgs30, turns7, turns30, cost7] =
    await Promise.all([
      admin
        .from("companies")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since7),
      admin
        .from("coaching_messages")
        .select("created_by")
        .gte("created_at", since7)
        .eq("role", "user"),
      admin
        .from("coaching_messages")
        .select("created_by")
        .gte("created_at", since30)
        .eq("role", "user"),
      admin
        .from("coaching_messages")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since7)
        .eq("role", "assistant"),
      admin
        .from("coaching_messages")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since30)
        .eq("role", "assistant"),
      admin
        .from("coach_token_usage")
        .select("cost_usd_cents")
        .gte("created_at", since7),
    ]);

  const distinct = (rows: Array<{ created_by: string }> | null | undefined) =>
    new Set((rows ?? []).map((r) => r.created_by)).size;
  const sum = (rows: Array<{ cost_usd_cents: number }> | null | undefined) =>
    (rows ?? []).reduce((acc, r) => acc + r.cost_usd_cents, 0);

  return {
    newCompanies7d: newCompanies.count ?? 0,
    activeUsers7d: distinct(msgs7.data),
    activeUsers30d: distinct(msgs30.data),
    turns7d: turns7.count ?? 0,
    turns30d: turns30.count ?? 0,
    costUsdCents7d: sum(cost7.data),
  };
}

// ---- Company activity table ----------------------------------------

export type CompanyActivityRow = {
  companyId: string;
  companyName: string;
  lastActiveAt: string | null;
  users7d: number;
  users30d: number;
  conversations7d: number;
  conversations30d: number;
  practicesStarted30d: number;
  costUsdCents30d: number;
  keepRate30d: number | null;
};

export async function getCompanyActivity(): Promise<CompanyActivityRow[]> {
  const admin = createSupabaseAdminClient();
  const since7 = daysAgo(7);
  const since30 = daysAgo(30);

  // One round-trip per aggregate is fine here — the dashboard is
  // low-traffic and we want to see raw rows for the distinct-user
  // counts. Parallelising keeps the wall time to whichever query is
  // slowest.
  const [companiesRes, msgs30, convos30, costs30, commits30] = await Promise.all([
    admin.from("companies").select("id, name"),
    admin
      .from("coaching_messages")
      .select("created_by, created_at, coaching_conversations!inner(company_id)")
      .gte("created_at", since30)
      .eq("role", "user"),
    admin
      .from("coaching_conversations")
      .select("id, company_id, created_at, practice_id")
      .gte("created_at", since30),
    admin
      .from("coach_token_usage")
      .select("company_id, cost_usd_cents")
      .gte("created_at", since30),
    admin
      .from("commitments")
      .select("company_id, status")
      .gte("week_ending", new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10))
      // Both kept statuses; "kept" alone has matched nothing since
      // migration 0139, which pinned every company's keep-rate on the
      // platform admin dashboard to 0.
      .in("status", ["kept_on_time", "kept_late", "missed"]),
  ]);

  type MsgRow = {
    created_by: string;
    created_at: string;
    coaching_conversations:
      | { company_id: string | null }
      | Array<{ company_id: string | null }>;
  };
  const messageRows = (msgs30.data ?? []) as MsgRow[];
  type ConvoRow = {
    id: string;
    company_id: string | null;
    created_at: string;
    practice_id: string | null;
  };
  const convoRows = (convos30.data ?? []) as ConvoRow[];
  type CostRow = { company_id: string | null; cost_usd_cents: number };
  const costRows = (costs30.data ?? []) as CostRow[];
  type CommitRow = { company_id: string; status: string };
  const commitRows = (commits30.data ?? []) as CommitRow[];

  const companies = (companiesRes.data ?? []) as Array<{
    id: string;
    name: string;
  }>;

  // Bucket everything by company id.
  const users7 = new Map<string, Set<string>>();
  const users30 = new Map<string, Set<string>>();
  const lastActive = new Map<string, string>();
  for (const m of messageRows) {
    const conv = Array.isArray(m.coaching_conversations)
      ? m.coaching_conversations[0]
      : m.coaching_conversations;
    const companyId = conv?.company_id;
    if (!companyId) continue;
    if (!users30.has(companyId)) users30.set(companyId, new Set());
    users30.get(companyId)!.add(m.created_by);
    if (m.created_at >= since7) {
      if (!users7.has(companyId)) users7.set(companyId, new Set());
      users7.get(companyId)!.add(m.created_by);
    }
    const prev = lastActive.get(companyId);
    if (!prev || m.created_at > prev) lastActive.set(companyId, m.created_at);
  }

  const convos7 = new Map<string, number>();
  const convos30Count = new Map<string, number>();
  const practicesStarted = new Map<string, number>();
  for (const c of convoRows) {
    if (!c.company_id) continue;
    convos30Count.set(c.company_id, (convos30Count.get(c.company_id) ?? 0) + 1);
    if (c.created_at >= since7) {
      convos7.set(c.company_id, (convos7.get(c.company_id) ?? 0) + 1);
    }
    if (c.practice_id) {
      practicesStarted.set(
        c.company_id,
        (practicesStarted.get(c.company_id) ?? 0) + 1
      );
    }
  }

  const cost30 = new Map<string, number>();
  for (const c of costRows) {
    if (!c.company_id) continue;
    cost30.set(c.company_id, (cost30.get(c.company_id) ?? 0) + c.cost_usd_cents);
  }

  const commitTotals = new Map<string, { kept: number; missed: number }>();
  for (const c of commitRows) {
    if (!commitTotals.has(c.company_id)) {
      commitTotals.set(c.company_id, { kept: 0, missed: 0 });
    }
    const rec = commitTotals.get(c.company_id)!;
    if (c.status === "kept_on_time" || c.status === "kept_late") {
      rec.kept += 1;
    }
    else if (c.status === "missed") rec.missed += 1;
  }

  return companies
    .map<CompanyActivityRow>((c) => {
      const totals = commitTotals.get(c.id);
      const denom = totals ? totals.kept + totals.missed : 0;
      return {
        companyId: c.id,
        companyName: c.name,
        lastActiveAt: lastActive.get(c.id) ?? null,
        users7d: users7.get(c.id)?.size ?? 0,
        users30d: users30.get(c.id)?.size ?? 0,
        conversations7d: convos7.get(c.id) ?? 0,
        conversations30d: convos30Count.get(c.id) ?? 0,
        practicesStarted30d: practicesStarted.get(c.id) ?? 0,
        costUsdCents30d: cost30.get(c.id) ?? 0,
        keepRate30d: denom > 0 ? (totals!.kept / denom) * 100 : null,
      };
    })
    .sort((a, b) => (b.conversations30d - a.conversations30d));
}

// ---- At-risk companies ---------------------------------------------

export type AtRiskCompany = {
  companyId: string;
  companyName: string;
  reason: string;
  lastActiveAt: string | null;
};

// v1 signal set (compose from the activity rows so we don't
// re-query the DB). "Coach activity" here means specifically a
// coach-chat conversation — NOT meeting-transcript ingest, which
// runs on its own pipeline. Reason strings say exactly that so an
// admin reading them doesn't wonder whether their transcript-heavy
// company has fallen off.
//   - No coach conversations in 14+ days
//   - Zero coach conversations this week AND ≥4 in the last 30
//     (steep drop)
//   - Follow-Through Rate below 40% over the last 30 days
export function computeAtRisk(
  rows: CompanyActivityRow[]
): AtRiskCompany[] {
  const now = Date.now();
  const cutoff14 = now - 14 * DAY_MS;
  const out: AtRiskCompany[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    const lastMs = r.lastActiveAt ? Date.parse(r.lastActiveAt) : null;
    if (!lastMs || lastMs < cutoff14) {
      reasons.push(
        lastMs
          ? `No coach conversations in ${Math.floor((now - lastMs) / DAY_MS)} days`
          : "No coach conversations on record"
      );
    }
    if (r.conversations7d === 0 && r.conversations30d >= 4) {
      reasons.push("Coach conversations dropped to zero this week");
    }
    if (r.keepRate30d !== null && r.keepRate30d < 40) {
      reasons.push(
        `Follow-Through Rate ${Math.round(r.keepRate30d)}% (below 40%)`
      );
    }
    if (reasons.length > 0) {
      out.push({
        companyId: r.companyId,
        companyName: r.companyName,
        reason: reasons.join(" · "),
        lastActiveAt: r.lastActiveAt,
      });
    }
  }
  return out;
}

// ---- Practice adoption ---------------------------------------------

export type PracticeAdoptionRow = {
  practiceId: string;
  title: string;
  started30d: number;
  multiTurn30d: number;
  companies30d: number;
};

// "Multi-turn" is the proxy for "the person actually engaged" —
// a conversation with 3+ messages total (their first + coach reply +
// at least one follow-up) is qualitatively different from one that
// ended after the opener.
export async function getPracticeAdoption(): Promise<PracticeAdoptionRow[]> {
  const admin = createSupabaseAdminClient();
  const since30 = daysAgo(30);

  const { data: convosData } = await admin
    .from("coaching_conversations")
    .select("id, practice_id, company_id")
    .not("practice_id", "is", null)
    .gte("created_at", since30);
  const convos = (convosData ?? []) as Array<{
    id: string;
    practice_id: string;
    company_id: string | null;
  }>;
  if (convos.length === 0) {
    return PRACTICES.map((p) => ({
      practiceId: p.id,
      title: p.title,
      started30d: 0,
      multiTurn30d: 0,
      companies30d: 0,
    }));
  }

  const convoIds = convos.map((c) => c.id);
  const { data: countsData } = await admin
    .from("coaching_messages")
    .select("conversation_id")
    .in("conversation_id", convoIds);
  const perConvoMsgCount = new Map<string, number>();
  for (const m of (countsData ?? []) as Array<{ conversation_id: string }>) {
    perConvoMsgCount.set(
      m.conversation_id,
      (perConvoMsgCount.get(m.conversation_id) ?? 0) + 1
    );
  }

  const byPractice = new Map<
    string,
    { started: number; multiTurn: number; companies: Set<string> }
  >();
  for (const p of PRACTICES) {
    byPractice.set(p.id, { started: 0, multiTurn: 0, companies: new Set() });
  }
  for (const c of convos) {
    const rec = byPractice.get(c.practice_id);
    if (!rec) continue;
    rec.started += 1;
    const n = perConvoMsgCount.get(c.id) ?? 0;
    if (n >= 3) rec.multiTurn += 1;
    if (c.company_id) rec.companies.add(c.company_id);
  }

  return PRACTICES.map<PracticeAdoptionRow>((p) => {
    const rec = byPractice.get(p.id)!;
    return {
      practiceId: p.id,
      title: p.title,
      started30d: rec.started,
      multiTurn30d: rec.multiTurn,
      companies30d: rec.companies.size,
    };
  }).sort((a, b) => b.started30d - a.started30d);
}

// ---- Model cost summary --------------------------------------------

export type ModelCostSummary = {
  totalCents7d: number;
  totalCents30d: number;
  byDay: Array<{ date: string; cents: number }>;
  byCompany: Array<{
    companyId: string | null;
    companyName: string;
    cents30d: number;
  }>;
};

export async function getModelCostSummary(): Promise<ModelCostSummary> {
  const admin = createSupabaseAdminClient();
  const since30 = daysAgo(30);
  const since7 = daysAgo(7);

  const [rowsRes, companiesRes] = await Promise.all([
    admin
      .from("coach_token_usage")
      .select("company_id, cost_usd_cents, created_at")
      .gte("created_at", since30),
    admin.from("companies").select("id, name"),
  ]);
  const rows = (rowsRes.data ?? []) as Array<{
    company_id: string | null;
    cost_usd_cents: number;
    created_at: string;
  }>;
  const companies = new Map<string, string>();
  for (const c of (companiesRes.data ?? []) as Array<{
    id: string;
    name: string;
  }>) {
    companies.set(c.id, c.name);
  }

  let totalCents7d = 0;
  let totalCents30d = 0;
  const byDay = new Map<string, number>();
  const byCompany = new Map<string | null, number>();
  for (const r of rows) {
    totalCents30d += r.cost_usd_cents;
    if (r.created_at >= since7) totalCents7d += r.cost_usd_cents;
    const day = r.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + r.cost_usd_cents);
    byCompany.set(r.company_id, (byCompany.get(r.company_id) ?? 0) + r.cost_usd_cents);
  }

  // Fill missing days with zero so the daily chart draws a smooth
  // ridge instead of gaps.
  const days: Array<{ date: string; cents: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    days.push({ date: d, cents: byDay.get(d) ?? 0 });
  }

  return {
    totalCents7d,
    totalCents30d,
    byDay: days,
    byCompany: Array.from(byCompany.entries())
      .map(([companyId, cents30d]) => ({
        companyId,
        companyName: companyId
          ? companies.get(companyId) ?? "Unknown"
          : "Uncategorised (Ask Aimee)",
        cents30d,
      }))
      .sort((a, b) => b.cents30d - a.cents30d),
  };
}

// ---- Signups / churn strip -----------------------------------------

export type SignupStats = {
  newCompanies7d: number;
  newUsers7d: number;
  deactivatedUsers7d: number;
  pendingInvites: number;
};

export async function getSignupStats(): Promise<SignupStats> {
  const admin = createSupabaseAdminClient();
  const since7 = daysAgo(7);

  const [newCompanies, newUsers, deactivated, pending] = await Promise.all([
    admin
      .from("companies")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since7),
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since7),
    // "Deactivated in the last 7 days" — we don't have a per-status
    // audit log, so approximate with profiles that are currently
    // inactive and whose updated_at falls in the window.
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("status", "inactive")
      .gte("updated_at", since7),
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  return {
    newCompanies7d: newCompanies.count ?? 0,
    newUsers7d: newUsers.count ?? 0,
    deactivatedUsers7d: deactivated.count ?? 0,
    pendingInvites: pending.count ?? 0,
  };
}

// ---- Latest themes snapshot ----------------------------------------

export type ThemeItem = { label: string; count: number; description: string };
export type ThemesSnapshot = {
  themes: ThemeItem[];
  sourceCount: number;
  refreshedAt: string | null;
};

export async function getLatestThemes(): Promise<ThemesSnapshot> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("coach_theme_snapshot")
    .select("themes, source_count, refreshed_at")
    .order("refreshed_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      themes: unknown;
      source_count: number;
      refreshed_at: string;
    }>();
  if (!data) return { themes: [], sourceCount: 0, refreshedAt: null };
  const themes = Array.isArray(data.themes)
    ? (data.themes as ThemeItem[])
    : [];
  return {
    themes,
    sourceCount: data.source_count,
    refreshedAt: data.refreshed_at,
  };
}
