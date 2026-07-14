"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Quarter } from "@/lib/types";

// Quarter server actions — Section 8.8 + Section 4.2.
//
// At most one open quarter per company (enforced by the partial
// unique index quarters_one_open). Closing a quarter does not
// modify its children; it freezes it and drops it from "current"
// pickers.

export type QuarterResult =
  | { ok: true; quarter: Quarter }
  | { ok: false; message: string };

function requireCompanyContext(session: {
  profile: { role: string; company_id: string | null };
}, companyIdFromForm: string): string | null {
  if (session.profile.role === "system_admin") {
    return companyIdFromForm || null;
  }
  return session.profile.company_id;
}

export async function openQuarterAction(
  _prev: QuarterResult | undefined,
  formData: FormData
): Promise<QuarterResult> {
  const session = await requireRole(["system_admin", "company_admin"]);

  const label = String(formData.get("label") ?? "").trim();
  const startDate = String(formData.get("start_date") ?? "").trim();
  const endDate = String(formData.get("end_date") ?? "").trim();
  const companyId = requireCompanyContext(
    session,
    String(formData.get("company_id") ?? "")
  );

  if (!companyId) {
    return { ok: false, message: "Pick a company for this quarter first." };
  }
  if (!label || !startDate || !endDate) {
    return { ok: false, message: "Label, start date, and end date are all required." };
  }
  if (endDate < startDate) {
    return { ok: false, message: "End date can't come before start date." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quarters")
    .insert({
      company_id: companyId,
      label,
      start_date: startDate,
      end_date: endDate,
      status: "open",
    })
    .select("*")
    .single<Quarter>();

  if (error || !data) {
    if (error?.code === "23505") {
      // Either duplicate label OR another quarter is already open.
      return {
        ok: false,
        message:
          "There's already an open quarter or a quarter with that label.",
      };
    }
    return { ok: false, message: "Couldn't open that quarter." };
  }

  revalidatePath("/quarters");
  revalidatePath("/dashboard");
  return { ok: true, quarter: data };
}

export async function closeQuarterAction(
  quarterId: string
): Promise<QuarterResult> {
  const session = await requireRole(["system_admin", "company_admin"]);

  const supabase = await createSupabaseServerClient();

  // Load and verify the caller has access to the quarter's company.
  const { data: existing } = await supabase
    .from("quarters")
    .select("*")
    .eq("id", quarterId)
    .maybeSingle<Quarter>();
  if (!existing) return { ok: false, message: "Quarter not found." };
  if (
    session.profile.role === "company_admin" &&
    existing.company_id !== session.profile.company_id
  ) {
    return { ok: false, message: "Not your quarter to close." };
  }
  if (existing.status === "closed") {
    return { ok: false, message: "That quarter is already closed." };
  }

  const { data, error } = await supabase
    .from("quarters")
    .update({ status: "closed" })
    .eq("id", quarterId)
    .select("*")
    .single<Quarter>();
  if (error || !data) {
    return { ok: false, message: "Couldn't close that quarter." };
  }

  revalidatePath("/quarters");
  revalidatePath("/dashboard");
  return { ok: true, quarter: data };
}

export async function reopenQuarterAction(
  quarterId: string
): Promise<QuarterResult> {
  const session = await requireRole(["system_admin", "company_admin"]);

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("quarters")
    .select("*")
    .eq("id", quarterId)
    .maybeSingle<Quarter>();
  if (!existing) return { ok: false, message: "Quarter not found." };
  if (
    session.profile.role === "company_admin" &&
    existing.company_id !== session.profile.company_id
  ) {
    return { ok: false, message: "Not your quarter to reopen." };
  }

  const { data, error } = await supabase
    .from("quarters")
    .update({ status: "open" })
    .eq("id", quarterId)
    .select("*")
    .single<Quarter>();
  if (error || !data) {
    if (error?.code === "23505") {
      return {
        ok: false,
        message:
          "Another quarter is already open. Close it before reopening this one.",
      };
    }
    return { ok: false, message: "Couldn't reopen that quarter." };
  }

  revalidatePath("/quarters");
  revalidatePath("/dashboard");
  return { ok: true, quarter: data };
}
