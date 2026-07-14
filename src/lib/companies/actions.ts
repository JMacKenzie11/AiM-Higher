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

export async function createCompanyAction(
  _prev: CompanyResult | undefined,
  formData: FormData
): Promise<CompanyResult> {
  await requireRole(["system_admin"]);

  const name = String(formData.get("name") ?? "").trim();
  const timezone =
    String(formData.get("timezone") ?? "America/Anchorage").trim();
  const redirectAfter = String(formData.get("redirect_after") ?? "");

  if (!name) return { ok: false, message: "Give the company a name." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .insert({ name, timezone })
    .select("*")
    .single<Company>();

  if (error || !data) {
    return { ok: false, message: "Couldn't create that company." };
  }

  revalidatePath("/admin/companies");

  // Callers can opt into an immediate redirect (Phase 2 minimal admin
  // did this). Section 8.9's polished list wants to stay on the list.
  if (redirectAfter === "detail") {
    redirect(`/admin/companies/${data.id}`);
  }

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
