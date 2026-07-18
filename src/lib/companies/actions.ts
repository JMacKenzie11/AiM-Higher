"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import type { Company } from "@/lib/types";

// Company management — polished in Phase 8 per Section 8.9.

export type CompanyResult =
  | { ok: true; company: Company }
  | { ok: false; message: string };

const VALID_FEATURES = new Set(["execution", "strengths"]);

export async function createCompanyAction(
  _prev: CompanyResult | undefined,
  formData: FormData
): Promise<CompanyResult> {
  await requireRole(["system_admin"]);

  const name = String(formData.get("name") ?? "").trim();
  const timezone =
    String(formData.get("timezone") ?? "America/Anchorage").trim();
  const redirectAfter = String(formData.get("redirect_after") ?? "");
  const features = Array.from(
    new Set(
      formData
        .getAll("features")
        .map((v) => String(v).trim())
        .filter((v) => VALID_FEATURES.has(v))
    )
  );

  if (!name) return { ok: false, message: "Give the company a name." };
  if (features.length === 0) {
    return { ok: false, message: "Pick at least one feature." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .insert({ name, timezone })
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
    new Set(features.map((f) => f.trim()).filter((f) => VALID_FEATURES.has(f)))
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
  return { ok: true };
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
