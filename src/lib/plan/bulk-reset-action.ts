"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
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

  // isAdminForCompany, not a hand-rolled check on company_admin.
  //
  // THE BUG THIS FIXES. The old guard tested only whether a
  // company_admin was in the right company. An aims_guide fell
  // straight through it — requireRole admitted them, nothing below
  // asked whether the company was in their caseload, and the writes
  // then ran as them.
  //
  // RLS held: the UPDATE policies on these three tables admit a guide
  // only through is_guide_for(), so an unassigned guide matched no
  // rows and nothing was archived. NOTHING WAS EVER DESTROYED. What
  // came back was `{ ok: true, sfaCount: 0, goalCount: 0,
  // priorityCount: 0 }` — a success report for an action that had
  // been refused, which is the failure mode that looks exactly like
  // the harmless one. "Reset complete, 0 items" and "you are not
  // allowed to do this" rendered identically.
  //
  // The shared helper admits system_admin unconditionally,
  // company_admin on their own company, and aims_guide on their
  // assignments — which is the rule this was trying to express, and
  // the one every other write path on these tables already uses.
  // portfolio_admin is absent from requireRole above and from this
  // helper, both correctly: archiving a company's plan is a content
  // write, and that role has none.
  if (!isAdminForCompany(session.profile, companyId)) {
    return { ok: false, message: "Not your company to reset." };
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
  // Zeros here now mean one thing only: there was nothing active to
  // archive. Before the guard above, they could also mean the caller
  // was refused, and the two were indistinguishable to the UI.
  return {
    ok: true,
    sfaCount: sfaRes.data?.length ?? 0,
    goalCount: goalRes.data?.length ?? 0,
    priorityCount: priorityRes.data?.length ?? 0,
  };
}
