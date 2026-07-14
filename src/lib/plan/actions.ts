"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AnnualGoal,
  CascadeStatus,
  Priority,
  StrategicFocusArea,
} from "@/lib/types";

// Plan cascade server actions — Section 4.3 + Section 5.
//
// Two write paths per level:
//   1. Admin path (createX/updateX/archiveX): full field access.
//   2. Owner-status path (updateXStatus): only the status column.
// Both paths are also protected by RLS (admin OR owner update policies
// from 0005_cascade.sql). Column-level scoping for owners lives here.

export type PlanResult<T> =
  | { ok: true; item: T }
  | { ok: false; message: string };

const CASCADE_STATUSES: readonly CascadeStatus[] = [
  "not_started",
  "on_track",
  "behind",
  "complete",
  "ongoing",
];

function parseStatus(raw: string): CascadeStatus | null {
  return CASCADE_STATUSES.includes(raw as CascadeStatus)
    ? (raw as CascadeStatus)
    : null;
}

function scopedCompanyId(
  session: { profile: { role: string; company_id: string | null } },
  formCompanyId: string
): string | null {
  if (session.profile.role === "system_admin") {
    return formCompanyId || session.profile.company_id;
  }
  return session.profile.company_id;
}

function nullableString(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length === 0 ? null : value;
}

// =============================================================
// Strategic Focus Areas
// =============================================================

export async function createSfaAction(
  _prev: PlanResult<StrategicFocusArea> | undefined,
  formData: FormData
): Promise<PlanResult<StrategicFocusArea>> {
  const session = await requireRole(["system_admin", "company_admin"]);

  const companyId = scopedCompanyId(
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

// =============================================================
// Annual Goals
// =============================================================

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

// =============================================================
// Priorities
// =============================================================

export async function createPriorityAction(
  _prev: PlanResult<Priority> | undefined,
  formData: FormData
): Promise<PlanResult<Priority>> {
  const session = await requireRole(["system_admin", "company_admin"]);
  const companyId = scopedCompanyId(
    session,
    String(formData.get("company_id") ?? "")
  );
  if (!companyId) return { ok: false, message: "Pick a company first." };

  const quarterId = String(formData.get("quarter_id") ?? "").trim();
  if (!quarterId) return { ok: false, message: "Pick a quarter for this priority." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Give this priority a title." };

  const goalId = nullableString(formData.get("annual_goal_id"));
  const description = nullableString(formData.get("description"));
  const ownerId = nullableString(formData.get("owner_id"));
  const dueDate = nullableString(formData.get("due_date"));
  const status = parseStatus(String(formData.get("status") ?? "not_started"))
    ?? "not_started";

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("priorities")
    .insert({
      company_id: companyId,
      annual_goal_id: goalId,
      quarter_id: quarterId,
      title,
      description,
      owner_id: ownerId,
      due_date: dueDate,
      status,
    })
    .select("*")
    .single<Priority>();
  if (error || !data) return { ok: false, message: "Couldn't create that priority." };

  revalidatePath("/plan");
  if (goalId) revalidatePath(`/plan/goal/${goalId}`);
  return { ok: true, item: data };
}

export async function updatePriorityAction(
  _prev: PlanResult<Priority> | undefined,
  formData: FormData
): Promise<PlanResult<Priority>> {
  await requireRole(["system_admin", "company_admin"]);
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing priority id." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Title can't be empty." };

  const goalId = nullableString(formData.get("annual_goal_id"));
  const description = nullableString(formData.get("description"));
  const ownerId = nullableString(formData.get("owner_id"));
  const dueDate = nullableString(formData.get("due_date"));
  const quarterId = nullableString(formData.get("quarter_id"));
  const status = parseStatus(String(formData.get("status") ?? ""));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("priorities")
    .update({
      title,
      annual_goal_id: goalId,
      description,
      owner_id: ownerId,
      due_date: dueDate,
      ...(quarterId ? { quarter_id: quarterId } : {}),
      ...(status ? { status } : {}),
    })
    .eq("id", id)
    .select("*")
    .single<Priority>();
  if (error || !data) return { ok: false, message: "Couldn't save changes." };

  revalidatePath("/plan");
  revalidatePath(`/plan/priority/${id}`);
  return { ok: true, item: data };
}

export async function updatePriorityStatusAction(
  priorityId: string,
  status: CascadeStatus
): Promise<PlanResult<Priority>> {
  if (!parseStatus(status)) {
    return { ok: false, message: "Not a valid status." };
  }
  const session = await requireProfile();

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("priorities")
    .select("*")
    .eq("id", priorityId)
    .maybeSingle<Priority>();
  if (!existing) return { ok: false, message: "Priority not found." };

  const isAdmin =
    session.profile.role === "system_admin" ||
    (session.profile.role === "company_admin" &&
      session.profile.company_id === existing.company_id);
  const isOwner = existing.owner_id === session.profile.id;
  if (!isAdmin && !isOwner) {
    return { ok: false, message: "You can't change this status." };
  }

  const { data, error } = await supabase
    .from("priorities")
    .update({ status })
    .eq("id", priorityId)
    .select("*")
    .single<Priority>();
  if (error || !data) return { ok: false, message: "Couldn't update status." };

  revalidatePath("/plan");
  revalidatePath(`/plan/priority/${priorityId}`);
  return { ok: true, item: data };
}

export async function archivePriorityAction(
  priorityId: string,
  archived: boolean
): Promise<PlanResult<Priority>> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("priorities")
    .update({ archived })
    .eq("id", priorityId)
    .select("*")
    .single<Priority>();
  if (error || !data) return { ok: false, message: "Couldn't archive." };
  revalidatePath("/plan");
  return { ok: true, item: data };
}

export async function setPriorityGoalAction(
  priorityId: string,
  goalId: string | null
): Promise<PlanResult<Priority>> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("priorities")
    .update({ annual_goal_id: goalId })
    .eq("id", priorityId)
    .select("*")
    .single<Priority>();
  if (error || !data) {
    return { ok: false, message: "Couldn't link that priority." };
  }
  revalidatePath("/plan");
  revalidatePath(`/plan/priority/${priorityId}`);
  return { ok: true, item: data };
}
