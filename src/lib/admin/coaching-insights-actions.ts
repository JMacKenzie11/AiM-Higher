"use server";

import { requireRole } from "@/lib/auth/current-user";
import {
  getCoachingInsightsAdoption,
  getCoachingInsightsSynthesis,
  type CoachingInsightsAdoption,
  type CoachingInsightsFilters,
  type CoachingInsightsSynthesis,
} from "./coaching-insights-service";

// Server action wrapper the CoachingInsightsCard fires on every
// filter change. Sysadmin-gated so a redirect happens if the
// caller loses their role mid-session; also enforces the same
// gate the /admin/dashboard route uses so there's no admin-only
// data path a non-sysadmin could ever reach.
//
// One round-trip returns both slices (adoption + synthesis) so
// the whole card re-renders together on a filter change without
// two staggered loading states.
export async function fetchCoachingInsightsAction(
  filters: CoachingInsightsFilters
): Promise<
  | {
      ok: true;
      adoption: CoachingInsightsAdoption;
      synthesis: CoachingInsightsSynthesis;
    }
  | { ok: false; message: string }
> {
  await requireRole(["system_admin"]);
  try {
    const [adoption, synthesis] = await Promise.all([
      getCoachingInsightsAdoption(filters),
      getCoachingInsightsSynthesis(filters),
    ]);
    return { ok: true, adoption, synthesis };
  } catch (err) {
    console.error("fetchCoachingInsightsAction failed", err);
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Failed to load insights.",
    };
  }
}
