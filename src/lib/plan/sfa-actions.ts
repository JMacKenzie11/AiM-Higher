"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth/current-user";
import { COMPANY_ADMIN_ROLES, isAdminForCompany, scopedCompanyId } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { trackAfter } from "@/lib/analytics/track";
import { nullableString } from "@/lib/utils";
import type { CascadeStatus, StrategicFocusArea } from "@/lib/types";
import { parseStatus, type PlanResult } from "./_shared";
import { planSfaReorder, type SfaPosition } from "./sfa-order";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Focus Areas. Admin path is full-field; owner path is
// status-only. Both defend behind RLS from 0005_cascade.sql.

export async function createSfaAction(
  _prev: PlanResult<StrategicFocusArea> | undefined,
  formData: FormData
): Promise<PlanResult<StrategicFocusArea>> {
  const session = await requireRole(COMPANY_ADMIN_ROLES);

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

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
  trackAfter(
    session.profile.id,
    "strategic_focus_area_created",
    { has_sponsor: Boolean(data.sponsor_id), initial_status: data.status },
    { company: data.company_id }
  );
  return { ok: true, item: data };
}

export async function updateSfaAction(
  _prev: PlanResult<StrategicFocusArea> | undefined,
  formData: FormData
): Promise<PlanResult<StrategicFocusArea>> {
  await requireRole(COMPANY_ADMIN_ROLES);
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing focus area id." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Title can't be empty." };

  const description = nullableString(formData.get("description"));
  const sponsorId = nullableString(formData.get("sponsor_id"));
  const status = parseStatus(String(formData.get("status") ?? ""));

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: existing } = await supabase
    .from("strategic_focus_areas")
    .select("*")
    .eq("id", sfaId)
    .maybeSingle<StrategicFocusArea>();
  if (!existing) return { ok: false, message: "Focus area not found." };

  const isAdmin = isAdminForCompany(session.profile, existing.company_id);
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

// Archiving a focus area takes its FINISHED goals with it. A goal
// marked complete under a theme the company has closed is history,
// and leaving it behind put it under "Goals without a focus area",
// which reads as work waiting to be placed (B&B Electric, 2026-11-12:
// six completed goals after three areas were archived at the roll).
// A goal still in progress stays on the plan and falls to that
// section on purpose: live work must not vanish with its heading.
//
// Goals first, so a refused goal write leaves the area where it was
// and the page still explains itself.
//
// Writes admitted (RLS, sfa_update_* and annual_goals_update_*):
// system_admin, the company's company_admin, an assigned aims_guide,
// a portfolio admin switched on as this company's admin.
export async function archiveSfaAction(
  sfaId: string,
  archived: boolean
): Promise<PlanResult<StrategicFocusArea>> {
  await requireRole(COMPANY_ADMIN_ROLES);
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  if (archived) {
    const { error: goalsError } = await supabase
      .from("annual_goals")
      .update({ archived: true })
      .eq("sfa_id", sfaId)
      .eq("status", "complete")
      .eq("archived", false);
    if (goalsError) return { ok: false, message: "Couldn't archive." };
  }
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

// Save the order a company admin dragged the focus areas into. The
// order is the company's, not the reader's: everybody sees the same.
//
// The page sends every live area in its new order, and each is
// numbered by where it now sits. Numbering all of them, not just the
// one that moved, because areas are created with sort_order 0 and a
// company that has never reordered has them tied (the page then falls
// back to creation date, which is how B&B Electric's "SFA #2" came to
// sit above "SFA #1"). Only rows whose number changes are written.
//
// Writes admitted (RLS, sfa_update_*): system_admin, the company's
// company_admin, an assigned aims_guide, a portfolio admin switched
// on as this company's admin.
export async function reorderSfasAction(
  orderedIds: string[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireRole(COMPANY_ADMIN_ROLES);
  if (orderedIds.length === 0) return { ok: true };
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: current, error: readError } = await supabase
    .from("strategic_focus_areas")
    .select("id, company_id, sort_order")
    .in("id", orderedIds);
  const rows = (current ?? []) as SfaPosition[];
  // Every id must be a row the caller can read, and all of one
  // company the caller administers: a list naming somebody else's
  // area, or two companies' areas, is refused whole.
  const companies = new Set(rows.map((row) => row.company_id));
  const [companyId] = [...companies];
  if (
    readError ||
    rows.length !== new Set(orderedIds).size ||
    companies.size !== 1 ||
    !isAdminForCompany(session.profile, companyId)
  ) {
    return { ok: false, message: "You can't reorder this plan." };
  }

  for (const change of planSfaReorder(rows, orderedIds)) {
    const { error } = await supabase
      .from("strategic_focus_areas")
      .update({ sort_order: change.sort_order })
      .eq("id", change.id);
    if (error) {
      return {
        ok: false,
        message: "Couldn't save the new order. Refresh and try again.",
      };
    }
  }

  revalidatePath("/plan");
  return { ok: true };
}
