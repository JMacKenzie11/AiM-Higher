"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Quarter } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

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
  const session = await requireRole(["system_admin", "company_admin", "aims_guide"]);

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

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
  const session = await requireRole(["system_admin", "company_admin", "aims_guide"]);

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

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
  const session = await requireRole(["system_admin", "company_admin", "aims_guide"]);

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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

// ---- Rolling ----------------------------------------------------
//
// Close the open quarter, open the next, carry the unfinished
// priorities forward. One database transaction, because the three
// half-states are each worse than not rolling at all — see the header
// of migration 0214.
//
// The dates are the CALLER'S. The form suggests the next calendar
// quarter and the person can type over it, exactly as opening always
// has. Nothing here validates a length or an overlap: the only rules
// are the table's own, end >= start and a unique label, and inventing
// more would be this function deciding what a quarter means for
// everybody.
export type RollResult =
  | { ok: true; moved: number; quarter: Quarter }
  | { ok: false; message: string };

export async function rollQuarterAction(
  _prev: RollResult | undefined,
  formData: FormData
): Promise<RollResult> {
  const session = await requireRole([
    "system_admin",
    "company_admin",
    "aims_guide",
  ]);

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
    return {
      ok: false,
      message: "Label, start date, and end date are all required.",
    };
  }
  if (endDate < startDate) {
    return { ok: false, message: "End date can't come before start date." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase.rpc("roll_quarter", {
    p_company_id: companyId,
    p_label: label,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    // A duplicate label is the one failure a person can fix from the
    // form, so it says so instead of "couldn't roll".
    if (error.code === "23505") {
      return {
        ok: false,
        message: `There is already a quarter called "${label}" in this company.`,
      };
    }
    return { ok: false, message: `Couldn't roll the quarter: ${error.message}` };
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    opened_quarter: string;
    moved: number;
  } | null;
  if (!row?.opened_quarter) {
    return { ok: false, message: "Couldn't roll the quarter." };
  }

  const { data: opened } = await supabase
    .from("quarters")
    .select("*")
    .eq("id", row.opened_quarter)
    .maybeSingle<Quarter>();

  revalidatePath("/quarters");
  revalidatePath("/plan");
  revalidatePath("/dashboard");
  revalidatePath("/commitments");
  revalidatePath(`/admin/companies/${companyId}`);

  return opened
    ? { ok: true, moved: row.moved ?? 0, quarter: opened }
    : { ok: false, message: "Rolled, but the new quarter could not be read back." };
}
