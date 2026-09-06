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

// Scoping in is an explicit act, and this is the only thing that
// performs it.
//
// It used to also happen as a side effect of GET /admin/companies/<id>
// in middleware, which meant a Link prefetch could move the operator
// into a company they never chose. That is gone: no request changes
// who you are acting as, only this action, reached by a button someone
// pressed. See scope-request.ts for the full history.
//
// Returns a destination rather than calling redirect(). The caller
// hard-navigates with window.location, and that is deliberate: Next's
// Router Cache is keyed by URL, not by cookie, so a client-side
// navigation after a scope switch would serve a previously-visited
// page (e.g. /leadership) from the old tenant while the sidebar
// already showed the new one. A full document load flushes the tree so
// every server component reads the fresh cookie. revalidatePath alone
// did not prove sufficient here.
export async function scopeIntoCompany(
  companyId: string,
  destination: string = "/dashboard"
): Promise<ScopeIntoResult> {
  // Both system admins and aims_guides can scope. For a guide the
  // target must be one of their assignments; enforcement relies on
  // session.profile.guide_company_ids (loaded by getCurrentSession)
  // so we don't need a fresh DB query here.
  const session = await requireRole(["system_admin", "aims_guide"]);

  if (session.profile.role === "aims_guide") {
    const assignments = session.profile.guide_company_ids ?? [];
    if (!assignments.includes(companyId)) {
      // Not theirs to enter. Say so rather than scoping them in.
      return { ok: false, message: "That company isn't in your caseload." };
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
  if (!target) {
    return { ok: false, message: "That company is no longer available." };
  }

  await setScopedCompanyCookie(companyId, session.profile.role);
  revalidatePath("/", "layout");
  return { ok: true, redirectTo: destination };
}

export async function exitCompanyScopeAction(): Promise<never> {
  await requireRole(["system_admin", "aims_guide"]);
  await clearScopedCompanyCookie();
  revalidatePath("/", "layout");
  redirect("/admin/companies");
}
