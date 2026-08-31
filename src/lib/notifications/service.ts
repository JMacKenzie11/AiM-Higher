import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { thisFriday, todayInTimezone } from "@/lib/dates";
import type { ModuleFeature } from "@/lib/subscriptions/service";

// Header notification service. Two sources feed the same
// NotificationItem[] shape rendered by NotificationBell:
//
//   1. STATE-DERIVED triggers (this file, unchanged). Nothing
//      persists; each header render recomputes them. Overdue
//      commitments, Friday metrics. They can never be "dismissed"
//      because the underlying state is the notification.
//
//   2. EVENT-BASED notifications (added in migration 0151). A row
//      in public.notifications, inserted via insertNotification()
//      below whenever an event fires (e.g., someone shares a
//      conversation with you). One-shot: `read_at` marks it
//      dismissed and the header hides it forever after.
//
// Kept intentionally cheap: 2-3 lightweight counts + one indexed
// SELECT per header render.
//
// Insert boundary: notifications RLS forbids INSERT for
// authenticated users, so every write goes through
// insertNotification() using the admin client. This shuts down
// the user-to-user spam vector — no client-code path can
// fabricate a notification for another user.

// Kind identifiers. Persisted events use the same string in
// public.notifications.kind so the header can dispatch on kind
// without a mapping layer.
export type NotificationKind =
  | "friday-metrics"
  | "overdue-commitments"
  | "due-today-commitments"
  | "chat_shared";

export type NotificationItem = {
  // Stable id for React key. Synthetic (kind-prefixed) for computed
  // items; real UUID for persisted rows so the mark-read action can
  // find them.
  id: string;
  kind: NotificationKind;
  // Small uppercase label above the title — e.g. "OVERDUE",
  // "DUE TODAY". Set when title carries the concrete item name
  // (rich single-item state) so the reader still knows what
  // bucket it's in.
  eyebrow?: string;
  title: string;
  href: string;
  // ISO timestamp; null for computed items where "when" isn't
  // meaningful — the condition is true right now, not because of a
  // moment in the past.
  createdAt: string | null;
  // True for persisted rows (event-based; clicking or a manual
  // dismiss should call markNotificationReadAction). Computed items
  // are never dismissible — they'd reappear on the next request.
  dismissible?: boolean;
};

export async function getHeaderNotifications({
  userId,
  companyId,
  timezone,
  features,
  hasChartMeasures,
}: {
  userId: string;
  companyId: string | null;
  timezone: string;
  features: readonly ModuleFeature[];
  hasChartMeasures: boolean;
}): Promise<NotificationItem[]> {
  // Cross-company roles that haven't scoped into a company have no
  // company-level data to notify on. Bail early.
  if (!companyId) return [];

  const supabase = await createSupabaseServerClient();
  const { iso: todayIso } = todayInTimezone(timezone);
  const thisFri = thisFriday(timezone);
  const isFriday = todayIso === thisFri;

  const items: NotificationItem[] = [];

  // Commitment triggers require the execution module (which owns the
  // /commitments surface). Skip both counts otherwise.
  //
  // Both queries fetch { id, description } LIMIT 1 alongside an exact
  // count — one round trip per trigger returns everything we need to
  // render either the rich single-item shape (show the description)
  // or the aggregate shape (show "N items").
  if (features.includes("execution")) {
    const [
      { data: overdueRows, count: overdue },
      { data: dueTodayRows, count: dueToday },
    ] = await Promise.all([
      supabase
        .from("commitments")
        .select("id, description", { count: "exact" })
        .eq("owner_id", userId)
        .eq("company_id", companyId)
        .eq("status", "open")
        .lt("due_date", todayIso)
        .order("due_date", { ascending: true })
        .limit(1),
      supabase
        .from("commitments")
        .select("id, description", { count: "exact" })
        .eq("owner_id", userId)
        .eq("company_id", companyId)
        .eq("status", "open")
        .eq("due_date", todayIso)
        .order("due_date", { ascending: true })
        .limit(1),
    ]);

    if ((overdue ?? 0) > 0) {
      const firstDesc = overdueRows?.[0]?.description as string | undefined;
      const rich = overdue === 1 && firstDesc;
      items.push({
        id: "overdue-commitments",
        kind: "overdue-commitments",
        eyebrow: rich ? "Overdue" : undefined,
        title: rich
          ? firstDesc
          : `${overdue} overdue commitments`,
        href: "/commitments",
        createdAt: null,
      });
    }
    if ((dueToday ?? 0) > 0) {
      const firstDesc = dueTodayRows?.[0]?.description as string | undefined;
      const rich = dueToday === 1 && firstDesc;
      items.push({
        id: "due-today-commitments",
        kind: "due-today-commitments",
        eyebrow: rich ? "Due today" : undefined,
        title: rich
          ? firstDesc
          : `${dueToday} commitments due today`,
        href: "/commitments",
        createdAt: null,
      });
    }
  }

  // Friday metrics gate — only fires on Friday in the company's tz,
  // only for tenants using Success Tracking (paid entitlement, or a
  // legacy company already logging metrics). Counts measures the
  // caller leads that don't yet have a value for this week and
  // aren't auto-tracked.
  const hasMeasuresSurface =
    features.includes("performance_tracking") || hasChartMeasures;
  if (isFriday && hasMeasuresSurface) {
    const pending = await getPendingMeasuresForUser({
      supabase,
      companyId,
      userId,
      weekEnding: thisFri,
    });
    if (pending.count > 0) {
      const isRich = pending.count === 1 && pending.firstDescription !== null;
      items.push({
        id: "friday-metrics",
        kind: "friday-metrics",
        eyebrow: isRich ? "Log this week's number" : undefined,
        title: isRich
          ? (pending.firstDescription as string)
          : `Log this week's numbers — ${pending.count} left`,
        href: "/measures",
        createdAt: null,
      });
    }
  }

  // Persisted (event-based) notifications for this user. Scoped to
  // the current company scope so a system_admin or guide sees only
  // events raised inside the tenant they're currently in. RLS is
  // recipient_id = auth.uid() so cross-user leakage is already
  // blocked; the company filter is a UX belt so a scope switch
  // doesn't drag notifications from the other tenant along.
  const { data: persistedRows } = await supabase
    .from("notifications")
    .select("id, kind, eyebrow, title, href, created_at")
    .eq("recipient_id", userId)
    .eq("company_id", companyId)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  const persisted = (persistedRows ?? []) as Array<{
    id: string;
    kind: string;
    eyebrow: string | null;
    title: string;
    href: string;
    created_at: string;
  }>;
  for (const row of persisted) {
    items.push({
      id: row.id,
      kind: row.kind as NotificationKind,
      eyebrow: row.eyebrow ?? undefined,
      title: row.title,
      href: row.href,
      createdAt: row.created_at,
      dismissible: true,
    });
  }

  return items;
}

// ---- Insert (event source path) -----------------------------
// Called from server actions when an event fires. Uses the admin
// client because notifications RLS forbids INSERT to authenticated
// — that's the boundary that prevents user-to-user spam. Callers
// MUST have already authorized the event (e.g., shareConversationAction
// already checked the caller owns the conversation) before invoking
// this helper.
export async function insertNotification(input: {
  recipientId: string;
  companyId: string;
  kind: NotificationKind;
  title: string;
  href: string;
  eyebrow?: string;
  payload?: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  // Self-notifications are almost always a bug (why ping yourself
  // for something you just did?), so silently skip rather than
  // insert. Callers that legitimately want a self-note can pass a
  // sentinel later; today, no such case exists.
  if (input.recipientId === input.createdBy) {
    return { ok: false, message: "skipped self-notification" };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("notifications")
    .insert({
      recipient_id: input.recipientId,
      company_id: input.companyId,
      kind: input.kind,
      title: input.title,
      href: input.href,
      eyebrow: input.eyebrow ?? null,
      payload: input.payload ?? {},
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    console.error("insertNotification failed", error);
    return { ok: false, message: error?.message ?? "insert failed" };
  }
  return { ok: true, id: data.id };
}

async function getPendingMeasuresForUser({
  supabase,
  companyId,
  userId,
  weekEnding,
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  companyId: string;
  userId: string;
  weekEnding: string;
}): Promise<{ count: number; firstDescription: string | null }> {
  // Same ownership model as getMeasuresOwnedBy: leader_id on
  // functions decides who's on the hook. Chain the joins narrowly
  // so we don't pull full rows we'll never read.
  const empty = { count: 0, firstDescription: null };
  const { data: functions } = await supabase
    .from("functions")
    .select("id")
    .eq("company_id", companyId)
    .eq("archived", false)
    .eq("leader_id", userId);
  const functionIds = (functions ?? []).map((f) => f.id as string);
  if (functionIds.length === 0) return empty;

  const { data: outcomes } = await supabase
    .from("function_outcomes")
    .select("id")
    .in("function_id", functionIds);
  const outcomeIds = (outcomes ?? []).map((o) => o.id as string);
  if (outcomeIds.length === 0) return empty;

  // Pull description too — if exactly one measure ends up pending,
  // the tray can show it by name instead of just a count.
  const { data: measures } = await supabase
    .from("success_measures")
    .select("id, description, auto_track")
    .in("outcome_id", outcomeIds)
    .eq("archived", false);
  const manual = (measures ?? []).filter(
    (m) => !(m as { auto_track: boolean }).auto_track
  ) as Array<{ id: string; description: string }>;
  if (manual.length === 0) return empty;
  const manualIds = manual.map((m) => m.id);

  const { data: entries } = await supabase
    .from("success_measure_entries")
    .select("measure_id")
    .in("measure_id", manualIds)
    .eq("week_ending", weekEnding);
  const filled = new Set(
    (entries ?? []).map((e) => (e as { measure_id: string }).measure_id)
  );

  const pending = manual.filter((m) => !filled.has(m.id));
  return {
    count: pending.length,
    firstDescription: pending.length === 1 ? pending[0].description : null,
  };
}
