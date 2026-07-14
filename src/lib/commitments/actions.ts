"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Commitment, Priority } from "@/lib/types";
import { addDays, thisFriday } from "@/lib/dates";

// Commitment server actions — Section 4.4 semantics.
//
//   Kept:  set status='kept', completed_at=now(). If completed AFTER
//          the due date, we instead set status='missed' + completed_at
//          (Section 4.4 "Completed late" state) and require a reason.
//          For the plain "mark as Kept" button in the weekly review,
//          we treat late as still Kept (the meeting is happening after
//          the due date; the intent is that the item got done). The
//          Missed path is the one that requires a reason.
//   Missed: status='missed', missed_reason=<text>. UI enforces
//           requiring a reason; the DB check enforces it too.
//   Carry Forward: status='carried' on original; insert a new row
//                  for week_ending+7 with carried_from_id set.
//   Delete: owner may delete own open commitments in the CURRENT
//           WEEK only. Admins may delete any in their company.

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

// Every commitment mutation touches three surfaces at once: the weekly
// review page, the dashboard totals, and the priority's history table.
// Hoisting the revalidatePath triplet so callers can't accidentally
// forget one.
function revalidateCommitmentSurfaces(priorityId: string): void {
  revalidatePath("/weekly-review");
  revalidatePath("/dashboard");
  revalidatePath(`/plan/priority/${priorityId}`);
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

// ---- Create ---------------------------------------------------
export async function createCommitmentAction(
  _prev: CommitmentResult | undefined,
  formData: FormData
): Promise<CommitmentResult> {
  const session = await requireProfile();

  const priorityId = String(formData.get("priority_id") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const weekEnding = String(formData.get("week_ending") ?? "").trim();
  const dueDateRaw = String(formData.get("due_date") ?? "").trim();
  const ownerIdRaw = String(formData.get("owner_id") ?? "").trim();

  if (!priorityId) {
    return { ok: false, message: "Pick a priority for this commitment." };
  }
  if (!description) {
    return { ok: false, message: "Say what the commitment is." };
  }
  if (!weekEnding) {
    return { ok: false, message: "Missing week." };
  }
  const dueDate = dueDateRaw || weekEnding;

  // Look up the priority so we can validate company + owner rules.
  const supabase = await createSupabaseServerClient();
  const { data: priority } = await supabase
    .from("priorities")
    .select("id, company_id")
    .eq("id", priorityId)
    .maybeSingle<Pick<Priority, "id" | "company_id">>();
  if (!priority) {
    return { ok: false, message: "That priority isn't accessible." };
  }

  // Team members may only commit for themselves. Admins may pick anyone.
  const role = session.profile.role;
  const isAdmin =
    role === "system_admin" ||
    (role === "company_admin" &&
      session.profile.company_id === priority.company_id);
  const ownerId = isAdmin && ownerIdRaw ? ownerIdRaw : session.profile.id;

  const { data, error } = await supabase
    .from("commitments")
    .insert({
      company_id: priority.company_id,
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

// ---- Missed ---------------------------------------------------
export async function markMissedAction(
  commitmentId: string,
  reason: string,
  completedLate = false
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
      // "Completed late" per Section 4.4: still counts as missed for
      // keep-rate math, but we record completed_at so history shows it.
      completed_at: completedLate ? new Date().toISOString() : null,
    })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) return { ok: false, message: "Couldn't mark that missed." };

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: data };
}

// ---- Carry Forward --------------------------------------------
export async function carryForwardAction(
  commitmentId: string,
  descriptionOverride?: string
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const original = await loadCommitment(supabase, commitmentId);
  if (!original) return { ok: false, message: "Commitment not found." };
  if (!(await canWriteRow(session, original))) {
    return { ok: false, message: "Not yours to carry." };
  }
  if (original.status !== "open") {
    return { ok: false, message: "That commitment isn't open anymore." };
  }

  const nextWeek = addDays(original.week_ending, 7);
  const description = (descriptionOverride ?? original.description).trim();

  // Close original.
  const { error: closeError } = await supabase
    .from("commitments")
    .update({ status: "carried" })
    .eq("id", original.id);
  if (closeError) {
    return { ok: false, message: "Couldn't close the original commitment." };
  }

  // Insert the successor.
  const { data: successor, error: insertError } = await supabase
    .from("commitments")
    .insert({
      company_id: original.company_id,
      priority_id: original.priority_id,
      owner_id: original.owner_id,
      description,
      week_ending: nextWeek,
      due_date: nextWeek,
      status: "open",
      carried_from_id: original.id,
    })
    .select("*")
    .single<Commitment>();
  if (insertError || !successor) {
    // Best-effort revert so we don't leave the old row half-closed.
    await supabase
      .from("commitments")
      .update({ status: "open" })
      .eq("id", original.id);
    return { ok: false, message: "Couldn't create the carried commitment." };
  }

  revalidateCommitmentSurfaces(original.priority_id);
  return { ok: true, commitment: successor };
}

// ---- Delete ---------------------------------------------------
export async function deleteCommitmentAction(
  commitmentId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };

  const role = session.profile.role;
  const isAdmin =
    role === "system_admin" ||
    (role === "company_admin" &&
      session.profile.company_id === commitment.company_id);

  if (!isAdmin) {
    // Owner can only delete their own OPEN commitment in the CURRENT WEEK.
    if (commitment.owner_id !== session.profile.id) {
      return { ok: false, message: "Not yours to delete." };
    }
    if (commitment.status !== "open") {
      return {
        ok: false,
        message: "Resolved commitments stay in history — they can't be deleted.",
      };
    }
    const { data: company } = await supabase
      .from("companies")
      .select("timezone")
      .eq("id", commitment.company_id)
      .maybeSingle<{ timezone: string }>();
    const timezone = company?.timezone ?? "America/Anchorage";
    if (commitment.week_ending !== thisFriday(timezone)) {
      return {
        ok: false,
        message:
          "Only this week's open commitments can be deleted. Older ones live in history.",
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
