import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { thisFriday, todayInTimezone } from "@/lib/dates";
import type { ModuleFeature } from "@/lib/subscriptions/service";

// Header notification service — computes the live triggers rendered by
// NotificationBell in the top nav. All items are STATE-DERIVED (not
// events), so nothing persists — each call recomputes the current
// picture. When we later add event-based notifications (meeting-
// analysis-complete, coach messages, assignments), those will land in
// a real `notifications` table and be merged into this same
// NotificationItem[] shape without changing the header consumer.
//
// Kept intentionally cheap: 2-3 lightweight counts per header render,
// each a HEAD-only exact count with no row payload. Gated by module
// feature so an execution-only tenant doesn't pay for a measure check.

export type NotificationItem = {
  // Stable id for React key. Synthetic (kind-prefixed) for computed
  // items; real UUID once event-persisted notifications ship.
  id: string;
  kind:
    | "friday-metrics"
    | "overdue-commitments"
    | "due-today-commitments";
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
  // Reserved for the future event-based path — computed items are
  // never dismissible (they'd reappear on the next request anyway).
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

  return items;
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
