"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth/current-user";
import { scopedCompanyId } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { nullableString } from "@/lib/utils";
import type { AnnualGoal, CascadeStatus } from "@/lib/types";
import { parseStatus, type PlanResult } from "./_shared";

export async function createGoalAction(
  _prev: PlanResult<AnnualGoal> | undefined,
  formData: FormData
): Promise<PlanResult<AnnualGoal>> {
  const session = await requireRole(["system_admin", "company_admin"]);
  const companyId = scopedCompanyId(
    session,
    String(formData.get("company_id") ?? "")
  );
  if (!companyId) return { ok: false, message: "Pick a company first." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Give this annual goal a title." };

  const sfaId = nullableString(formData.get("sfa_id"));
  const description = nullableString(formData.get("description"));
  const ownerId = nullableString(formData.get("owner_id"));
  const targetDate = nullableString(formData.get("target_date"));
  const status = parseStatus(String(formData.get("status") ?? "not_started"))
    ?? "not_started";

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("annual_goals")
    .insert({
      company_id: companyId,
      sfa_id: sfaId,
      title,
      description,
      owner_id: ownerId,
      target_date: targetDate,
      status,
    })
    .select("*")
    .single<AnnualGoal>();
  if (error || !data) return { ok: false, message: "Couldn't create that goal." };

  revalidatePath("/plan");
  if (sfaId) revalidatePath(`/plan/sfa/${sfaId}`);
  return { ok: true, item: data };
}

export async function updateGoalAction(
  _prev: PlanResult<AnnualGoal> | undefined,
  formData: FormData
): Promise<PlanResult<AnnualGoal>> {
  await requireRole(["system_admin", "company_admin"]);
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing goal id." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Title can't be empty." };

  const sfaId = nullableString(formData.get("sfa_id"));
  const description = nullableString(formData.get("description"));
  const ownerId = nullableString(formData.get("owner_id"));
  const targetDate = nullableString(formData.get("target_date"));
  const status = parseStatus(String(formData.get("status") ?? ""));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("annual_goals")
    .update({
      title,
      sfa_id: sfaId,
      description,
      owner_id: ownerId,
      target_date: targetDate,
      ...(status ? { status } : {}),
    })
    .eq("id", id)
    .select("*")
    .single<AnnualGoal>();
  if (error || !data) return { ok: false, message: "Couldn't save changes." };

  revalidatePath("/plan");
  revalidatePath(`/plan/goal/${id}`);
  return { ok: true, item: data };
}

export async function updateGoalStatusAction(
  goalId: string,
  status: CascadeStatus
): Promise<PlanResult<AnnualGoal>> {
  if (!parseStatus(status)) {
    return { ok: false, message: "Not a valid status." };
  }
  const session = await requireProfile();

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("annual_goals")
    .select("*")
    .eq("id", goalId)
    .maybeSingle<AnnualGoal>();
  if (!existing) return { ok: false, message: "Goal not found." };

  const isAdmin =
    session.profile.role === "system_admin" ||
    (session.profile.role === "company_admin" &&
      session.profile.company_id === existing.company_id);
  const isOwner = existing.owner_id === session.profile.id;
  if (!isAdmin && !isOwner) {
    return { ok: false, message: "You can't change this status." };
  }

  const { data, error } = await supabase
    .from("annual_goals")
    .update({ status })
    .eq("id", goalId)
    .select("*")
    .single<AnnualGoal>();
  if (error || !data) return { ok: false, message: "Couldn't update status." };

  revalidatePath("/plan");
  revalidatePath(`/plan/goal/${goalId}`);
  return { ok: true, item: data };
}

export async function archiveGoalAction(
  goalId: string,
  archived: boolean
): Promise<PlanResult<AnnualGoal>> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("annual_goals")
    .update({ archived })
    .eq("id", goalId)
    .select("*")
    .single<AnnualGoal>();
  if (error || !data) return { ok: false, message: "Couldn't archive." };
  revalidatePath("/plan");
  return { ok: true, item: data };
}

// Link/unlink a goal's parent SFA.
export async function setGoalSfaAction(
  goalId: string,
  sfaId: string | null
): Promise<PlanResult<AnnualGoal>> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("annual_goals")
    .update({ sfa_id: sfaId })
    .eq("id", goalId)
    .select("*")
    .single<AnnualGoal>();
  if (error || !data) return { ok: false, message: "Couldn't link that goal." };
  revalidatePath("/plan");
  revalidatePath(`/plan/goal/${goalId}`);
  return { ok: true, item: data };
}
