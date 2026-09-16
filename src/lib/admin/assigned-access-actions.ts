"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";

export type RemoveGuideResult =
  | { ok: true }
  | { ok: false; message: string };

// End a guide's engagement with a company. Spec §1a, decision 7.
//
// A company admin may do this without asking anybody, and the reason
// is about the relationship rather than about consistency: a guide
// may stop working with a company that carries on using AiMS HQ. The
// engagement ends and the product does not.
//
// A PORTFOLIO ADMIN'S ASSIGNMENT IS NOT REMOVABLE HERE, and that is
// decision 5 rather than an oversight. The portfolio owns the
// company, so a company cannot evict its owner's operator. This
// action only ever touches guide_assignments; portfolio_assignments
// has no delete path that admits a company_admin, and the harness
// asserts it stays that way.
//
// The caller's own client does the delete, so guide_assignments_delete
// is what decides. The check below is the courtesy half: it turns a
// silent no-op into a message. Both are needed, because a DELETE that
// RLS refuses removes zero rows and reports no error.
export async function removeGuideFromCompanyAction(
  companyId: string,
  guideId: string
): Promise<RemoveGuideResult> {
  const session = await requireProfile();
  if (!isAdminForCompany(session.profile, companyId)) {
    return {
      ok: false,
      message: "Only this company's admins can end an assignment.",
    };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { error, count } = await supabase
    .from("guide_assignments")
    .delete({ count: "exact" })
    .eq("guide_id", guideId)
    .eq("company_id", companyId);

  if (error) {
    return { ok: false, message: "Couldn't end that assignment." };
  }
  // Zero rows is the shape an RLS refusal takes, and it is also what
  // a row somebody else already removed looks like. Neither is a
  // success, and reporting one would leave the guide on the page
  // after a control that claimed to remove them.
  if (count === 0) {
    return {
      ok: false,
      message: "That assignment is already gone.",
    };
  }

  revalidatePath(`/admin/companies/${companyId}`);
  return { ok: true };
}
