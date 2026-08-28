"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { calendarQuarterOf } from "@/lib/quarters/service";
import { VALID_COMPANY_FEATURES } from "@/lib/companies/features";
import type { Company } from "@/lib/types";

// Company management — polished in Phase 8 per Section 8.9.

export type CompanyResult =
  | { ok: true; company: Company }
  | { ok: false; message: string };

export async function createCompanyAction(
  _prev: CompanyResult | undefined,
  formData: FormData
): Promise<CompanyResult> {
  await requireRole(["system_admin"]);

  const name = String(formData.get("name") ?? "").trim();
  const timezone =
    String(formData.get("timezone") ?? "America/Anchorage").trim();
  const industryRaw = String(formData.get("industry") ?? "").trim();
  const industry = industryRaw.length > 0 ? industryRaw : null;
  const redirectAfter = String(formData.get("redirect_after") ?? "");
  const features = Array.from(
    new Set(
      formData
        .getAll("features")
        .map((v) => String(v).trim())
        .filter((v) => VALID_COMPANY_FEATURES.has(v))
    )
  );

  if (!name) return { ok: false, message: "Give the company a name." };
  if (features.length === 0) {
    return { ok: false, message: "Pick at least one feature." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .insert({ name, timezone, industry })
    .select("*")
    .single<Company>();

  if (error || !data) {
    return { ok: false, message: "Couldn't create that company." };
  }

  const { error: featuresError } = await supabase
    .from("company_features")
    .insert(features.map((feature) => ({ company_id: data.id, feature })));
  if (featuresError) {
    // Company row exists but entitlements didn't land — surface the
    // failure so the admin can retry from the detail page.
    return {
      ok: false,
      message: "Company created but features didn't save — open it and set them.",
    };
  }

  // Seed the two default leadership functions every company starts
  // with. Visionary is the single top-level box; Integrator reports
  // to it. Every subsequent function the operator adds must pick a
  // parent (Visionary, Integrator, or any downstream function).
  // Failure is non-fatal — the admin can add them manually on the
  // chart page if the insert bounces.
  const { data: visionary } = await supabase
    .from("functions")
    .insert({
      company_id: data.id,
      parent_function_id: null,
      title: "Visionary",
      description:
        "CEO — sets the long-term vision, priorities and cultural tone.",
      sort_order: 0,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (visionary?.id) {
    await supabase.from("functions").insert({
      company_id: data.id,
      parent_function_id: visionary.id,
      title: "Integrator",
      description:
        "COO — turns the vision into execution across the leadership team.",
      sort_order: 0,
    });
  }

  // Seed the current calendar quarter so admins can drop actions in
  // immediately without an "open a quarter first" detour. Best-effort:
  // if the insert bounces (already exists somehow, RLS quirk) the
  // admin can still open one manually on /quarters.
  const currentQuarter = calendarQuarterOf(new Date());
  await supabase.from("quarters").insert({
    company_id: data.id,
    label: currentQuarter.label,
    start_date: currentQuarter.startDate,
    end_date: currentQuarter.endDate,
    status: "open",
  });

  revalidatePath("/admin/companies");

  // Callers can opt into an immediate redirect (Phase 2 minimal admin
  // did this). Section 8.9's polished list wants to stay on the list.
  if (redirectAfter === "detail") {
    redirect(`/admin/companies/${data.id}`);
  }

  return { ok: true, company: data };
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

  const supabase = await createSupabaseServerClient();

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

  const supabase = await createSupabaseServerClient();
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

  const supabase = await createSupabaseServerClient();
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
