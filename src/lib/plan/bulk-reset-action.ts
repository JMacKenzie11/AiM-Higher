"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Bulk Reset archives all active SFAs/Goals/Priorities for a company.
// Commitments are left untouched (linkage remains for history — reads
// filter archived out of active surfaces).

export type BulkResetResult =
  | {
      ok: true;
      sfaCount: number;
      goalCount: number;
      priorityCount: number;
    }
  | { ok: false; message: string };

export async function bulkResetPlanAction(
  companyId: string
): Promise<BulkResetResult> {
  const session = await requireRole(["system_admin", "company_admin"]);
  if (
    session.profile.role === "company_admin" &&
    session.profile.company_id !== companyId
  ) {
    return { ok: false, message: "Wrong company scope." };
  }

  const supabase = await createSupabaseServerClient();

  const [sfaRes, goalRes, priorityRes] = await Promise.all([
    supabase
      .from("strategic_focus_areas")
      .update({ archived: true })
      .eq("company_id", companyId)
      .eq("archived", false)
      .select("id"),
    supabase
      .from("annual_goals")
      .update({ archived: true })
      .eq("company_id", companyId)
      .eq("archived", false)
      .select("id"),
    supabase
      .from("priorities")
      .update({ archived: true })
      .eq("company_id", companyId)
      .eq("archived", false)
      .select("id"),
  ]);

  if (sfaRes.error || goalRes.error || priorityRes.error) {
    return {
      ok: false,
      message: "Reset couldn't finish. Some items may still be active.",
    };
  }

  revalidatePath("/plan");
  revalidatePath("/dashboard");
  revalidatePath("/commitments");
  return {
    ok: true,
    sfaCount: sfaRes.data?.length ?? 0,
    goalCount: goalRes.data?.length ?? 0,
    priorityCount: priorityRes.data?.length ?? 0,
  };
}
