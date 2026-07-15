"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Commitment, Priority } from "@/lib/types";
import { todayInTimezone } from "@/lib/dates";

// Commitment server actions — simplified per the "Open / Kept / Missed"
// model (migration 0011 dropped the carried state).
//
//   Kept:    status='kept', completed_at=now(). Server rejects on
//            overdue open rows — those go through Missed.
//   Missed:  status='missed', missed_reason=<text>. In the UI this is
//            labelled "Closed" — a commitment closed after its due
//            date. The reason is required (DB check enforces too).
//   Unmark:  either resolved state → open (drops completed_at and
//            missed_reason). Any owner or admin can revert any week.
//   Link:    priority_id may be null (operational commitment). Only
//            mutable while status='open' — resolved rows have
//            already fed priority progress.
//   Delete:  owner may delete their own OPEN commitment, any week.
//            Admins may delete any in their company.

export type CommitmentResult =
  | { ok: true; commitment: Commitment }
  | { ok: false; message: string };

async function loadCommitment(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  id: string
): Promise<Commitment | null> {
  const { data } = await supabase
    .from("commitments")
    .select("*")
    .eq("id", id)
    .maybeSingle<Commitment>();
  return data ?? null;
}

function revalidateCommitmentSurfaces(priorityId: string | null): void {
  revalidatePath("/commitments");
  revalidatePath("/dashboard");
  if (priorityId) revalidatePath(`/plan/priority/${priorityId}`);
}

async function canWriteRow(
  session: Awaited<ReturnType<typeof requireProfile>>,
  commitment: Commitment
): Promise<boolean> {
  const role = session.profile.role;
  if (role === "system_admin") return true;
  if (
    role === "company_admin" &&
    session.profile.company_id === commitment.company_id
  ) {
    return true;
  }
  return commitment.owner_id === session.profile.id;
}

function isAdminForCompany(
  session: Awaited<ReturnType<typeof requireProfile>>,
  companyId: string
): boolean {
  const role = session.profile.role;
  if (role === "system_admin") return true;
  return role === "company_admin" && session.profile.company_id === companyId;
}

async function getCompanyTimezone(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string
): Promise<string> {
  const { data } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string }>();
  return data?.timezone ?? "America/Anchorage";
}

// ---- Create ---------------------------------------------------
export async function createCommitmentAction(
  _prev: CommitmentResult | undefined,
  formData: FormData
): Promise<CommitmentResult> {
  const session = await requireProfile();

  const priorityIdRaw = String(formData.get("priority_id") ?? "").trim();
  const priorityId = priorityIdRaw === "" ? null : priorityIdRaw;
  const description = String(formData.get("description") ?? "").trim();
  const weekEnding = String(formData.get("week_ending") ?? "").trim();
  const dueDateRaw = String(formData.get("due_date") ?? "").trim();
  const ownerIdRaw = String(formData.get("owner_id") ?? "").trim();

  if (!description) {
    return { ok: false, message: "Say what the commitment is." };
  }
  if (!weekEnding) {
    return { ok: false, message: "Missing week." };
  }
  const dueDate = dueDateRaw || weekEnding;

  const supabase = await createSupabaseServerClient();

  let companyId: string | null;
  if (priorityId) {
    const { data: priority } = await supabase
      .from("priorities")
      .select("id, company_id")
      .eq("id", priorityId)
      .maybeSingle<Pick<Priority, "id" | "company_id">>();
    if (!priority) {
      return { ok: false, message: "That priority isn't accessible." };
    }
    companyId = priority.company_id;
  } else {
    companyId = await getEffectiveCompanyId(session);
    if (!companyId) {
      return { ok: false, message: "Pick a company scope first." };
    }
  }

  const isAdmin = isAdminForCompany(session, companyId);
  const ownerId = isAdmin && ownerIdRaw ? ownerIdRaw : session.profile.id;

  const { data, error } = await supabase
    .from("commitments")
    .insert({
      company_id: companyId,
      priority_id: priorityId,
      owner_id: ownerId,
      description,
      week_ending: weekEnding,
      due_date: dueDate,
      status: "open",
    })
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't save that commitment." };
  }

  revalidateCommitmentSurfaces(priorityId);
  return { ok: true, commitment: data };
}

// ---- Kept -----------------------------------------------------
export async function markKeptAction(
  commitmentId: string
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!(await canWriteRow(session, commitment))) {
    return { ok: false, message: "Not yours to resolve." };
  }
  if (commitment.status !== "open") {
    return { ok: false, message: "That commitment isn't open anymore." };
  }

  // Overdue open rows go through Missed (which is labelled "Closed" in
  // the UI). Kept is on-time only. Enforced here so a stale UI or
  // crafted request can't sneak past.
  const tz = await getCompanyTimezone(supabase, commitment.company_id);
  const { iso: todayIso } = todayInTimezone(tz);
  if (commitment.due_date < todayIso) {
    return {
      ok: false,
      message: "Past its due date — close it with a reason instead.",
    };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({
      status: "kept",
      completed_at: new Date().toISOString(),
      missed_reason: null,
    })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) return { ok: false, message: "Couldn't mark that kept." };

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: data };
}

// ---- Unmark kept (revert to open) ------------------------------
// Any owner or admin, any week. Absorbs misclicks and lets people fix
// history without an admin gate.
export async function unmarkKeptAction(
  commitmentId: string
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!(await canWriteRow(session, commitment))) {
    return { ok: false, message: "Not yours to change." };
  }
  if (commitment.status !== "kept") {
    return { ok: false, message: "Only kept commitments can be reverted." };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({ status: "open", completed_at: null, missed_reason: null })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't revert that commitment." };
  }

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: data };
}

// ---- Missed (Closed late) -------------------------------------
export async function markMissedAction(
  commitmentId: string,
  reason: string
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const trimmed = reason.trim();
  if (!trimmed) {
    return {
      ok: false,
      message: "Add a short reason so the pattern is visible over time.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!(await canWriteRow(session, commitment))) {
    return { ok: false, message: "Not yours to resolve." };
  }
  if (commitment.status !== "open") {
    return { ok: false, message: "That commitment isn't open anymore." };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({
      status: "missed",
      missed_reason: trimmed,
      completed_at: new Date().toISOString(),
    })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) return { ok: false, message: "Couldn't close that." };

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: data };
}

// ---- Unmark missed (revert Closed → Open) ---------------------
// Same permission story as unmark kept: any owner or admin, any week.
export async function unmarkMissedAction(
  commitmentId: string
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!(await canWriteRow(session, commitment))) {
    return { ok: false, message: "Not yours to change." };
  }
  if (commitment.status !== "missed") {
    return { ok: false, message: "Only closed commitments can be reopened." };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({ status: "open", completed_at: null, missed_reason: null })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't reopen that commitment." };
  }

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: data };
}

// ---- Link / unlink priority -----------------------------------
// Only mutable while open, so resolved rows can't be silently retargeted
// between priorities (that would rewrite priority progress history).
// priorityId=null unlinks (turns the row operational). When linking,
// the priority must belong to the open quarter.
export async function linkPriorityAction(
  commitmentId: string,
  priorityId: string | null
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!(await canWriteRow(session, commitment))) {
    return { ok: false, message: "Not yours to change." };
  }
  if (commitment.status !== "open") {
    return {
      ok: false,
      message: "Resolved commitments have already fed priority progress — their link is frozen.",
    };
  }

  if (priorityId) {
    const { data: priority } = await supabase
      .from("priorities")
      .select("id, company_id, quarter_id")
      .eq("id", priorityId)
      .maybeSingle<Pick<Priority, "id" | "company_id" | "quarter_id">>();
    if (!priority || priority.company_id !== commitment.company_id) {
      return { ok: false, message: "That priority isn't accessible." };
    }
    const { data: quarter } = await supabase
      .from("quarters")
      .select("status")
      .eq("id", priority.quarter_id)
      .maybeSingle<{ status: string }>();
    if (quarter?.status !== "open") {
      return {
        ok: false,
        message: "Only priorities in the open quarter can be linked.",
      };
    }
  }

  const previousPriorityId = commitment.priority_id;
  const { data, error } = await supabase
    .from("commitments")
    .update({ priority_id: priorityId })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't update the link." };
  }

  revalidateCommitmentSurfaces(previousPriorityId);
  revalidateCommitmentSurfaces(priorityId);
  return { ok: true, commitment: data };
}

// ---- Delete ---------------------------------------------------
export async function deleteCommitmentAction(
  commitmentId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };

  const isAdmin = isAdminForCompany(session, commitment.company_id);
  if (!isAdmin) {
    if (commitment.owner_id !== session.profile.id) {
      return { ok: false, message: "Not yours to delete." };
    }
    if (commitment.status !== "open") {
      return {
        ok: false,
        message: "Resolved commitments stay in history — they can't be deleted.",
      };
    }
  }

  const { error } = await supabase
    .from("commitments")
    .delete()
    .eq("id", commitmentId);
  if (error) return { ok: false, message: "Couldn't delete that commitment." };

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true };
}
