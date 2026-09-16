"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth/current-user";
import { scopedCompanyId } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { trackAfter } from "@/lib/analytics/track";
import { nullableString } from "@/lib/utils";
import type { CascadeStatus, Priority } from "@/lib/types";
import { parseStatus, type PlanResult } from "./_shared";
import { parentColumns, parseParentRef } from "./parent-ref";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

export async function createPriorityAction(
  _prev: PlanResult<Priority> | undefined,
  formData: FormData
): Promise<PlanResult<Priority>> {
  const session = await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const companyId = await scopedCompanyId(
    session,
    String(formData.get("company_id") ?? "")
  );
  if (!companyId) return { ok: false, message: "Pick a company first." };

  const quarterId = String(formData.get("quarter_id") ?? "").trim();
  if (!quarterId) return { ok: false, message: "Pick a quarter for this priority." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Give this priority a title." };

  // ONE parent field, two levels. A priority hangs off a goal or off
  // a focus area directly, and `parentColumns` always writes both
  // columns so one can never be left behind (see parent-ref.ts).
  const parent = parseParentRef(String(formData.get("parent") ?? ""));
  const parentCols = parentColumns(parent);
  const description = nullableString(formData.get("description"));
  const ownerId = nullableString(formData.get("owner_id"));
  const dueDate = nullableString(formData.get("due_date"));
  const status = parseStatus(String(formData.get("status") ?? "not_started"))
    ?? "not_started";

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("priorities")
    .insert({
      company_id: companyId,
      ...parentCols,
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
  if (parent.kind === "goal") revalidatePath(`/plan/goal/${parent.id}`);
  if (parent.kind === "sfa") revalidatePath(`/plan/sfa/${parent.id}`);
  trackAfter(
    session.profile.id,
    "priority_created",
    {
      has_annual_goal: Boolean(data.annual_goal_id),
      has_focus_area: Boolean(data.sfa_id),
      has_owner: Boolean(data.owner_id),
      has_due_date: Boolean(data.due_date),
      initial_status: data.status,
    },
    { company: data.company_id }
  );
  return { ok: true, item: data };
}

export async function updatePriorityAction(
  _prev: PlanResult<Priority> | undefined,
  formData: FormData
): Promise<PlanResult<Priority>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing priority id." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Title can't be empty." };

  const parentCols = parentColumns(
    parseParentRef(String(formData.get("parent") ?? ""))
  );
  const description = nullableString(formData.get("description"));
  const ownerId = nullableString(formData.get("owner_id"));
  const dueDate = nullableString(formData.get("due_date"));
  const quarterId = nullableString(formData.get("quarter_id"));
  const status = parseStatus(String(formData.get("status") ?? ""));

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("priorities")
    .update({
      title,
      ...parentCols,
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

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: existing } = await supabase
    .from("priorities")
    .select("*")
    .eq("id", priorityId)
    .maybeSingle<Priority>();
  if (!existing) return { ok: false, message: "Action not found." };

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
  if (existing.status !== status) {
    trackAfter(
      session.profile.id,
      "priority.status_changed",
      { from: existing.status, to: status },
      { company: existing.company_id }
      );
  }
  return { ok: true, item: data };
}

export async function archivePriorityAction(
  priorityId: string,
  archived: boolean
): Promise<PlanResult<Priority>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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

// Re-parent a standalone priority from the inline picker on /plan.
// Takes the wire form of a parent ref ("goal:<id>", "sfa:<id>", or
// "") rather than a goal id, because the picker now offers both
// levels in one list.
export async function setPriorityParentAction(
  priorityId: string,
  parentValue: string
): Promise<PlanResult<Priority>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("priorities")
    .update(parentColumns(parseParentRef(parentValue)))
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
