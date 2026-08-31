"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  clearScopedCompanyCookie,
  setScopedCompanyCookie,
} from "./scope";

// Server actions callable from Client Components.

export async function scopeIntoCompanyAction(
  companyId: string,
  redirectTo: string = "/dashboard"
): Promise<never> {
  // Both system admins and aims_guides can scope. For a guide the
  // target company must be one of their assignments; enforcement
  // relies on their session.profile.guide_company_ids (loaded by
  // getCurrentSession) so we don't need a fresh DB query here.
  const session = await requireRole(["system_admin", "aims_guide"]);
  if (session.profile.role === "aims_guide") {
    const assignments = session.profile.guide_company_ids ?? [];
    if (!assignments.includes(companyId)) {
      // Guide tried to scope into a company they aren't assigned to.
      // Bounce them back to the picker rather than silently allowing.
      redirect("/admin/companies");
    }
  }
  // Refuse to scope into a soft-deleted (or missing) company.
  // companies_hide_deleted RLS makes the SELECT return null when
  // deleted_at is set, so this doubles as an existence check.
  const supabase = await createSupabaseServerClient();
  const { data: target } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle<{ id: string }>();
  if (!target) redirect("/admin/companies");
  await setScopedCompanyCookie(companyId, session.profile.role);
  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export async function exitCompanyScopeAction(): Promise<never> {
  await requireRole(["system_admin", "aims_guide"]);
  await clearScopedCompanyCookie();
  revalidatePath("/", "layout");
  redirect("/admin/companies");
}
