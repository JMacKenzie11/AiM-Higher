"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Start a new planning cycle — archives every active SFA/Goal/Priority
// for the company and unlinks every OPEN commitment that pointed at
// those priorities so they surface as Operational rather than dangling
// off a now-archived link. Resolved commitments (kept/missed) keep
// their historical priority link intact.

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
  const session = await requireRole(["system_admin", "company_admin", "aims_guide"]);
  if (
    session.profile.role === "company_admin" &&
    session.profile.company_id !== companyId
  ) {
    return { ok: false, message: "Wrong company scope." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

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

  // Null out priority_id on OPEN commitments that were linked to any
  // priority we just archived. Purposefully skips resolved commitments
  // (kept/missed) so the historical link — and the priority progress
  // history it feeds — stays intact.
  const archivedPriorityIds =
    (priorityRes.data ?? []).map((row) => row.id) as string[];
  if (archivedPriorityIds.length > 0) {
    await supabase
      .from("commitments")
      .update({ priority_id: null })
      .eq("company_id", companyId)
      .eq("status", "open")
      .in("priority_id", archivedPriorityIds);
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
