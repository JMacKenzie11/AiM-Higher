"use server";

import { requireRole } from "@/lib/auth/current-user";
import {
  getCoachingInsightsAdoption,
  type CoachingInsightsAdoption,
  type CoachingInsightsFilters,
} from "./coaching-insights-service";

// Server action wrapper the CoachingInsightsCard fires on every
// filter change. Sysadmin-gated so a redirect happens if the
// caller loses their role mid-session; also enforces the same
// gate the /admin/dashboard route uses so there's no admin-only
// data path a non-sysadmin could ever reach.
export async function fetchCoachingInsightsAction(
  filters: CoachingInsightsFilters
): Promise<
  | { ok: true; adoption: CoachingInsightsAdoption }
  | { ok: false; message: string }
> {
  await requireRole(["system_admin"]);
  try {
    const adoption = await getCoachingInsightsAdoption(filters);
    return { ok: true, adoption };
  } catch (err) {
    console.error("fetchCoachingInsightsAction failed", err);
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Failed to load insights.",
    };
  }
}
