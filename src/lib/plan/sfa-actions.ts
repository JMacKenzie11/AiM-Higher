"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth/current-user";
import { scopedCompanyId } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { nullableString } from "@/lib/utils";
import type { CascadeStatus, StrategicFocusArea } from "@/lib/types";
import { parseStatus, type PlanResult } from "./_shared";

// Strategic Focus Areas. Admin path is full-field; owner path is
// status-only. Both defend behind RLS from 0005_cascade.sql.

export async function createSfaAction(
  _prev: PlanResult<StrategicFocusArea> | undefined,
  formData: FormData
): Promise<PlanResult<StrategicFocusArea>> {
  const session = await requireRole(["system_admin", "company_admin"]);

  const companyId = await scopedCompanyId(
    session,
    String(formData.get("company_id") ?? "")
  );
  if (!companyId) {
    return { ok: false, message: "Pick a company first." };
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Give this focus area a title." };

  const description = nullableString(formData.get("description"));
  const sponsorId = nullableString(formData.get("sponsor_id"));
  const status = parseStatus(String(formData.get("status") ?? "not_started"))
    ?? "not_started";

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("strategic_focus_areas")
    .insert({
      company_id: companyId,
      title,
      description,
      sponsor_id: sponsorId,
      status,
    })
    .select("*")
    .single<StrategicFocusArea>();
  if (error || !data) {
    return { ok: false, message: "Couldn't create that focus area." };
  }

  revalidatePath("/plan");
  return { ok: true, item: data };
}

export async function updateSfaAction(
  _prev: PlanResult<StrategicFocusArea> | undefined,
  formData: FormData
): Promise<PlanResult<StrategicFocusArea>> {
  await requireRole(["system_admin", "company_admin"]);
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing focus area id." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Title can't be empty." };

  const description = nullableString(formData.get("description"));
  const sponsorId = nullableString(formData.get("sponsor_id"));
  const status = parseStatus(String(formData.get("status") ?? ""));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("strategic_focus_areas")
    .update({
      title,
      description,
      sponsor_id: sponsorId,
      ...(status ? { status } : {}),
    })
    .eq("id", id)
    .select("*")
    .single<StrategicFocusArea>();
  if (error || !data) return { ok: false, message: "Couldn't save changes." };

  revalidatePath("/plan");
  revalidatePath(`/plan/sfa/${id}`);
  return { ok: true, item: data };
}

// Owner-status-only path. Admins may also call this.
export async function updateSfaStatusAction(
  sfaId: string,
  status: CascadeStatus
): Promise<PlanResult<StrategicFocusArea>> {
  if (!parseStatus(status)) {
    return { ok: false, message: "Not a valid status." };
  }
  const session = await requireProfile();

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("strategic_focus_areas")
    .select("*")
    .eq("id", sfaId)
    .maybeSingle<StrategicFocusArea>();
  if (!existing) return { ok: false, message: "Focus area not found." };

  const isAdmin =
    session.profile.role === "system_admin" ||
    (session.profile.role === "company_admin" &&
      session.profile.company_id === existing.company_id);
  const isSponsor = existing.sponsor_id === session.profile.id;
  if (!isAdmin && !isSponsor) {
    return { ok: false, message: "You can't change this status." };
  }

  const { data, error } = await supabase
    .from("strategic_focus_areas")
    .update({ status })
    .eq("id", sfaId)
    .select("*")
    .single<StrategicFocusArea>();
  if (error || !data) return { ok: false, message: "Couldn't update status." };

  revalidatePath("/plan");
  revalidatePath(`/plan/sfa/${sfaId}`);
  return { ok: true, item: data };
}

export async function archiveSfaAction(
  sfaId: string,
  archived: boolean
): Promise<PlanResult<StrategicFocusArea>> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("strategic_focus_areas")
    .update({ archived })
    .eq("id", sfaId)
    .select("*")
    .single<StrategicFocusArea>();
  if (error || !data) return { ok: false, message: "Couldn't archive." };
  revalidatePath("/plan");
  return { ok: true, item: data };
}
