"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  clearScopedCompanyCookie,
  setScopedCompanyCookie,
} from "./scope";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Server actions callable from Client Components.

export type ScopeIntoResult =
  | { ok: true; redirectTo: string }
  | { ok: false; message: string };

// Kept the signature Promise<never> historically because it always
// redirect()'d. It now returns a result object when redirectTo is
// null so the client can hard-reload instead of a Next.js
// client-side navigation. That's the fix for the Router Cache
// staleness where the sidebar showed the new tenant while a
// previously-visited page (e.g. /leadership) served cached rows
// from the old tenant. A full window.location reload guarantees
// a fresh render of every server component in the tree.
export async function scopeIntoCompanyAction(
  companyId: string,
  redirectTo: string | null = "/dashboard"
): Promise<ScopeIntoResult | never> {
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
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: target } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle<{ id: string }>();
  if (!target) redirect("/admin/companies");
  await setScopedCompanyCookie(companyId, session.profile.role);
  revalidatePath("/", "layout");
  if (redirectTo === null) {
    // Caller wants to hard-reload on the client — return the
    // default destination so it knows where to send the user.
    return { ok: true, redirectTo: "/dashboard" };
  }
  redirect(redirectTo);
}

export async function exitCompanyScopeAction(): Promise<never> {
  await requireRole(["system_admin", "aims_guide"]);
  await clearScopedCompanyCookie();
  revalidatePath("/", "layout");
  redirect("/admin/companies");
}
