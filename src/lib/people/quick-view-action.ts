"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/current-user";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { computeRateFromCounts } from "@/lib/utils";
import type { Profile } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Lightweight person view fetched on-demand by the quick-view drawer
// on /commitments. Deliberately does less than getPersonScorecard:
// no trend chart, no history, no open-commitments list. Just enough
// to answer "who is this person, how are they doing, what should I
// do about it right now?" in the middle of a meeting.

export type PersonQuickView = {
  id: string;
  fullName: string;
  position: string | null;
  reportsTo: string | null;
  stats: {
    keepRate: number | null; // 0-100 for open quarter
    keptOnTimeCount: number;
    keptLateCount: number;
    missedCount: number;
    openCount: number;
  };
};

export type QuickViewResult =
  | { ok: true; view: PersonQuickView }
  | { ok: false; message: string };

export async function getPersonQuickViewAction(
  profileId: string
): Promise<QuickViewResult> {
  await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, position, reports_to, company_id")
    .eq("id", profileId)
    .maybeSingle<
      Pick<
        Profile,
        "id" | "full_name" | "position" | "reports_to" | "company_id"
      >
    >();
  if (!profile) return { ok: false, message: "Person not found." };

  const [openRes, resolvedRes] = await Promise.all([
    supabase
      .from("commitments")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", profileId)
      .is("deleted_at", null)
      .is("parked_at", null)
      .eq("status", "open"),
    supabase
      .from("commitments")
      .select("status")
      .eq("owner_id", profileId)
      .is("deleted_at", null)
      .is("parked_at", null)
      .in("status", ["kept_on_time", "kept_late", "missed"]),
  ]);

  const openCount = openRes.count ?? 0;
  const resolvedRows = (resolvedRes.data ?? []) as Array<{
    status: "kept_on_time" | "kept_late" | "missed";
  }>;

  // Keep rate is scoped to the current quarter for consistency with
  // the person scorecard and dashboard. When there's no open quarter
  // yet (early days of a company), return null and let the UI show —.
  let keptOnTimeCount = 0;
  let keptLateCount = 0;
  let missedCount = 0;
  const openQuarter = profile.company_id
    ? await getCurrentQuarter(profile.company_id)
    : null;
  if (openQuarter) {
    const { data: quarterRows } = await supabase
      .from("commitments")
      .select("status, week_ending")
      .eq("owner_id", profileId)
      .is("deleted_at", null)
      .is("parked_at", null)
      .gte("week_ending", openQuarter.start_date)
      .lte("week_ending", openQuarter.end_date)
      .in("status", ["kept_on_time", "kept_late", "missed"]);
    for (const r of (quarterRows ?? []) as Array<{
      status: "kept_on_time" | "kept_late" | "missed";
    }>) {
      if (r.status === "kept_on_time") keptOnTimeCount += 1;
      else if (r.status === "kept_late") keptLateCount += 1;
      else missedCount += 1;
    }
  } else {
    // Fall back to lifetime resolved counts so the drawer still shows
    // *something* meaningful pre-quarter.
    for (const r of resolvedRows) {
      if (r.status === "kept_on_time") keptOnTimeCount += 1;
      else if (r.status === "kept_late") keptLateCount += 1;
      else missedCount += 1;
    }
  }

  return {
    ok: true,
    view: {
      id: profile.id,
      fullName: profile.full_name,
      position: profile.position,
      reportsTo: profile.reports_to,
      stats: {
        keepRate: computeRateFromCounts(
          keptOnTimeCount,
          keptLateCount,
          missedCount
        ),
        keptOnTimeCount,
        keptLateCount,
        missedCount,
        openCount,
      },
    },
  };
}
