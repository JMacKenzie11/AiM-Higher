"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { requireProfile } from "@/lib/auth/current-user";
import { recordPortfolioEvent } from "@/lib/portfolio/audit";

export type CompanyAccessResult =
  | { ok: true; added: number; removed: number; released: number }
  | { ok: false; message: string };

// Set which companies a portfolio admin holds company-admin rights in.
// Spec §1a, decisions 1 and 2.
//
// SELF-ONLY, AND THE DATABASE SAYS SO FIRST.
// portfolio_assignments_insert (0199) admits the system_admin, or a
// portfolio_admin writing a row that names themselves. This action
// refuses anything else before it gets there, so the page never
// offers a control that RLS will silently decline.
//
// RELEASING THE WORK IS THE POINT OF THIS ACTION, not a side effect.
// Removing an assignment takes away the only write path they had into
// that company: commitments_update_owner requires
// `auth_company_id() = company_id`, and a portfolio admin's is always
// null, so owning a row was never enough — is_admin_for() was. Drop
// the assignment and any commitment they still own there becomes
// unresolvable by them AND renders as "Unassigned", because the
// roster lookup that resolves an owner's name no longer finds them.
// It looks claimable and is not: commitments_claim_unassigned wants
// `owner_id IS NULL`, and it is not null. A dead row.
//
// So open commitments they own in a company they are leaving are
// released to Unassigned, which is exactly what already happens when
// a person is deleted — commitments.owner_id is `on delete set null`
// (0121) and the delete-user copy says so out loud. Resolved ones
// keep their owner: history should stay true.
export async function setPortfolioCompanyAccessAction(
  portfolioAdminId: string,
  companyIds: string[]
): Promise<CompanyAccessResult> {
  const session = await requireProfile();
  const isSelf = session.profile.id === portfolioAdminId;
  const isSystemAdmin = session.profile.role === "system_admin";
  if (!isSelf && !isSystemAdmin) {
    return {
      ok: false,
      message: "You can only change your own company access.",
    };
  }
  if (isSelf && session.profile.role !== "portfolio_admin") {
    return { ok: false, message: "Only a portfolio admin holds company access." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: currentRows, error: readError } = await supabase
    .from("portfolio_assignments")
    .select("company_id")
    .eq("portfolio_admin_id", portfolioAdminId);
  if (readError) {
    return { ok: false, message: "Couldn't read your current access." };
  }
  const current = new Set(
    ((currentRows ?? []) as Array<{ company_id: string }>).map(
      (r) => r.company_id
    )
  );
  const wanted = new Set(companyIds);

  const toAdd = [...wanted].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !wanted.has(id));
  if (toAdd.length === 0 && toRemove.length === 0) {
    return { ok: true, added: 0, removed: 0, released: 0 };
  }

  if (toAdd.length > 0) {
    const { error } = await supabase.from("portfolio_assignments").insert(
      toAdd.map((company_id) => ({
        portfolio_admin_id: portfolioAdminId,
        company_id,
      }))
    );
    if (error) {
      return { ok: false, message: "Couldn't add that company access." };
    }
  }

  // RELEASE BEFORE REMOVING. While the assignment still stands,
  // is_admin_for() admits this caller to commitments_update_guide; the
  // moment it is gone they have no write path into that company and
  // could not release anything even if they wanted to. Order is the
  // whole difference between "released" and "stranded".
  let released = 0;
  for (const companyId of toRemove) {
    const { data, error } = await supabase
      .from("commitments")
      .update({ owner_id: null })
      .eq("company_id", companyId)
      .eq("owner_id", portfolioAdminId)
      .eq("status", "open")
      .is("deleted_at", null)
      .select("id");
    if (error) {
      return {
        ok: false,
        message:
          "Couldn't release your open commitments, so nothing was removed.",
      };
    }
    released += (data ?? []).length;
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("portfolio_assignments")
      .delete()
      .eq("portfolio_admin_id", portfolioAdminId)
      .in("company_id", toRemove);
    if (error) {
      return { ok: false, message: "Couldn't remove that company access." };
    }
  }

  // RECORDED, per decision 2. One row per company either way, so the
  // record answers "who took what, and when" rather than only "who
  // holds what now" — which the state already says and which says
  // nothing about how it got that way.
  //
  // recordPortfolioEvent is fire-and-report: the audit write must not
  // be able to fail the grant it is recording. It also only lands for
  // a portfolio admin acting on themselves, which is what
  // portfolio_admin_events_insert admits and what this table is for;
  // a system_admin editing somebody else's access writes no row here,
  // deliberately.
  for (const companyId of toAdd) {
    await recordPortfolioEvent({
      profile: session.profile,
      action: "company_access_granted",
      companyId,
      detail: { for_profile_id: portfolioAdminId },
    });
  }
  for (const companyId of toRemove) {
    await recordPortfolioEvent({
      profile: session.profile,
      action: "company_access_revoked",
      companyId,
      detail: { for_profile_id: portfolioAdminId, commitments_released: released },
    });
  }

  revalidatePath("/portfolio");
  revalidatePath("/people");
  return { ok: true, added: toAdd.length, removed: toRemove.length, released };
}
