"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createCompany } from "@/lib/companies/create-company";
import { VALID_COMPANY_FEATURES } from "@/lib/companies/features";
import { setScopedCompanyCookie } from "@/lib/admin/scope";
import type { Company } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Company management — polished in Phase 8 per Section 8.9.

export type CompanyResult =
  | { ok: true; company: Company }
  | { ok: false; message: string };

export async function createCompanyAction(
  _prev: CompanyResult | undefined,
  formData: FormData
): Promise<CompanyResult> {
  const session = await requireRole(["system_admin"]);

  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const industry = String(formData.get("industry") ?? "").trim();
  const redirectAfter = String(formData.get("redirect_after") ?? "");
  // The form's feature checkboxes. Passed through raw: createCompany
  // validates them against the catalogue and refuses an empty set, so
  // this action does not get to decide what a valid feature is.
  const features = formData.getAll("features").map((v) => String(v));

  // Everything else a new company gets — its chart roots, its opening
  // quarter — is decided inside createCompany() and deliberately not
  // expressible here. See the note on the boundary in
  // lib/companies/create-company.ts.
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const result = await createCompany(supabase, {
    name,
    timezone,
    industry,
    features,
  });
  if (!result.ok) return result;

  revalidatePath("/admin/companies");

  // Callers can opt into an immediate redirect (Phase 2 minimal admin
  // did this). Section 8.9's polished list wants to stay on the list.
  if (redirectAfter === "detail") {
    // Scope in before sending them there. The caller is a system_admin
    // whose scope cookie points at some other company, or at nothing,
    // because this company did not exist a moment ago — and middleware
    // now sends a cross-tenant role asking for a company they are not
    // scoped into back to /hq. Without this the redirect below lands
    // on Guide HQ instead of the company just created, silently.
    await setScopedCompanyCookie(result.company.id, session.profile.role);
    redirect(`/admin/companies/${result.company.id}`);
  }

  return { ok: true, company: result.company };
}

export type CompanyFeaturesResult =
  | { ok: true }
  | { ok: false; message: string };

// Update an existing company's feature entitlements. Rows in
// company_features are the entitlement — the underlying strengths_/
// execution data tables are left alone. If someone stops paying for a
// module, removing the row hides it from the nav and (via
// buildCoachContext) stops it from feeding coaching guidance, but
// nothing in their history is deleted. Re-enabling later restores
// access to the same data.
export async function setCompanyFeaturesAction(
  companyId: string,
  features: string[]
): Promise<CompanyFeaturesResult> {
  await requireRole(["system_admin"]);

  const cleaned = Array.from(
    new Set(features.map((f) => f.trim()).filter((f) => VALID_COMPANY_FEATURES.has(f)))
  );
  if (cleaned.length === 0) {
    return { ok: false, message: "Pick at least one feature." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: existingRows } = await supabase
    .from("company_features")
    .select("feature")
    .eq("company_id", companyId);
  const existing = new Set(
    ((existingRows ?? []) as Array<{ feature: string }>).map((r) => r.feature)
  );
  const desired = new Set(cleaned);

  const toAdd = cleaned.filter((f) => !existing.has(f));
  const toRemove = Array.from(existing).filter((f) => !desired.has(f));

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("company_features")
      .insert(toAdd.map((feature) => ({ company_id: companyId, feature })));
    if (error) {
      return { ok: false, message: "Couldn't enable the new features." };
    }
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("company_features")
      .delete()
      .eq("company_id", companyId)
      .in("feature", toRemove);
    if (error) {
      return { ok: false, message: "Couldn't disable the removed features." };
    }
  }

  revalidatePath("/admin/companies");
  revalidatePath(`/admin/companies/${companyId}`);
  // Toggling a feature must also invalidate the app layout, otherwise
  // the sidebar keeps rendering the old feature set until the next
  // full page load — the exact symptom the "Classroom shows on every
  // company" report was pinned to. The layout re-fetches features on
  // its next render.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setCompanyIndustryAction(
  companyId: string,
  industry: string | null
): Promise<CompanyResult> {
  // Any admin role can edit their own company's industry — system
  // admins unconditionally, company admins on their own company,
  // aims_guides on assigned companies. isAdminForCompany enforces
  // the per-company scope.
  const session = await requireRole([
    "system_admin",
    "company_admin",
    "aims_guide",
  ]);
  if (!isAdminForCompany(session.profile, companyId)) {
    return { ok: false, message: "Not your company to edit." };
  }

  const cleaned =
    industry !== null && industry.trim().length > 0 ? industry.trim() : null;

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("companies")
    .update({ industry: cleaned })
    .eq("id", companyId)
    .select("*")
    .single<Company>();
  if (error || !data) {
    return { ok: false, message: "Couldn't update the industry." };
  }

  revalidatePath("/admin/companies");
  revalidatePath(`/admin/companies/${companyId}`);
  return { ok: true, company: data };
}

export async function setCompanyStatusAction(
  companyId: string,
  status: "active" | "archived"
): Promise<CompanyResult> {
  await requireRole(["system_admin"]);

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("companies")
    .update({ status })
    .eq("id", companyId)
    .select("*")
    .single<Company>();
  if (error || !data) {
    return { ok: false, message: "Couldn't update that company." };
  }

  revalidatePath("/admin/companies");
  revalidatePath(`/admin/companies/${companyId}`);
  return { ok: true, company: data };
}

// Soft-delete a company. Two-step: caller must have already
// archived it (setCompanyStatusAction) — the archive step is the
// safety on "delete an active tenant by accident." Sets deleted_at
// on the row; the companies_hide_deleted restrictive RLS policy
// (migration 0148) hides it from every SELECT across the app
// without any query-site changes. All child data (profiles,
// functions, commitments, meetings, transcripts, coaching
// conversations, snapshots) stays intact — the row is recoverable
// by clearing deleted_at in SQL if we ever need to.
//
// Return type is intentionally minimal: the same restrictive RLS
// policy that hides deleted rows from the app also hides the row
// from a `.select("*")` chained after the update, so we can't read
// the fresh row back with the authenticated client. Callers only
// need ok/message anyway.
export type CompanyDeleteResult =
  | { ok: true }
  | { ok: false; message: string };

export async function deleteCompanyAction(
  companyId: string
): Promise<CompanyDeleteResult> {
  await requireRole(["system_admin"]);

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: current } = await supabase
    .from("companies")
    .select("id, status")
    .eq("id", companyId)
    .maybeSingle<Pick<Company, "id" | "status">>();
  if (!current) return { ok: false, message: "Company not found." };
  if (current.status !== "archived") {
    return {
      ok: false,
      message: "Archive the company first, then delete it.",
    };
  }

  // Use the admin (service-role) client to bypass RLS for the write.
  // The restrictive companies_hide_deleted policy applies to the new
  // row's implicit RETURNING check on UPDATE — Postgres rejects the
  // update because deleted_at IS NOT NULL on the new row violates
  // the SELECT policy the RETURNING has to satisfy. The auth check
  // (requireRole system_admin + archived-status gate) has already
  // run above, so bypassing RLS here is safe.
  const adminSupabase = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error } = await adminSupabase
    .from("companies")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", companyId);
  if (error) {
    console.error("deleteCompanyAction: update failed", {
      companyId,
      supabaseError: error,
    });
    return { ok: false, message: "Couldn't delete that company." };
  }

  revalidatePath("/admin/companies");
  revalidatePath(`/admin/companies/${companyId}`);
  return { ok: true };
}
