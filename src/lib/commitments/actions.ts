"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { trackAfter } from "@/lib/analytics/track";
import {
  canWriteOwnedRow,
  isAdminForCompany,
  type SessionProfileLike,
} from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scoreCommitmentClarity } from "./clarity";
import type {
  Commitment,
  CommitmentOccurrence,
  CommitmentResolverRole,
  Priority,
} from "@/lib/types";
import { fridayOf, todayInTimezone } from "@/lib/dates";

// Commitment server actions. Resolution model per migration 0139:
//
//   Kept on time: due_date >= today AND owner clicked Keep. No reason.
//   Kept late:    due_date <  today AND owner (or admin) clicked Keep.
//                 Owner is prompted for a reason with an explicit Skip;
//                 admins are exempt from the prompt entirely.
//   Missed:       explicit "not done" resolution. Owner supplies a
//                 reason; admins are exempt.
//   Reschedule:   moves due_date + week_ending. Owner supplies a reason;
//                 admins are exempt and may change past-due dates.
//   Park:         clears due_date, sets parked_at. No reason. Excluded
//                 from all metrics + weekly flow. Bring back = unpark.
//   Delete:       soft delete (deleted_at) — retained for future signals.
//   Ongoing:      is_ongoing=true. Each resolution creates a row in
//                 commitment_occurrences for the current week and rolls
//                 due_date forward 7 days. The commitments row itself
//                 stays 'open' until Stop Repeating is invoked.
//
// resolved_by_role is stamped on every resolution ('owner' | 'admin' |
// 'guide') so downstream can distinguish "no reason from owner" from
// "resolved by admin in the meeting."

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

// Classify who's doing the resolving. Owner vs admin vs guide drives
// the reason-requirement rules: admins + guides are exempt from every
// reason prompt (they typically resolve during the weekly meeting on
// someone else's behalf and there's nothing more to say). Owner acts
// on their own commitment.
function resolverRoleFor(
  profile: SessionProfileLike,
  commitment: Pick<Commitment, "company_id" | "owner_id">
): CommitmentResolverRole | null {
  if (profile.role === "system_admin") return "admin";
  if (
    profile.role === "company_admin" &&
    profile.company_id === commitment.company_id
  ) {
    return "admin";
  }
  if (
    profile.role === "aims_guide" &&
    (profile.guide_company_ids ?? []).includes(commitment.company_id)
  ) {
    return "guide";
  }
  if (commitment.owner_id === profile.id) return "owner";
  return null;
}

function isAdminOrGuide(role: CommitmentResolverRole | null): boolean {
  return role === "admin" || role === "guide";
}

// Add N days to an ISO date (YYYY-MM-DD) and return the new ISO date.
// Used to roll ongoing commitments' due_date forward one week on
// each resolution.
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

// ---- Create ---------------------------------------------------
export async function createCommitmentAction(
  _prev: CommitmentResult | undefined,
  formData: FormData
): Promise<CommitmentResult> {
  const session = await requireProfile();

  // Link taxonomy (per migration 0143): a commitment may carry AT
  // MOST ONE of priority_id / issue_id / functional_area_id. The
  // composer picks one; the DB check constraint is the final gate.
  const priorityIdRaw = String(formData.get("priority_id") ?? "").trim();
  const priorityId = priorityIdRaw === "" ? null : priorityIdRaw;
  const issueIdRaw = String(formData.get("issue_id") ?? "").trim();
  const issueId = issueIdRaw === "" ? null : issueIdRaw;
  const functionalAreaIdRaw = String(
    formData.get("functional_area_id") ?? ""
  ).trim();
  const functionalAreaId =
    functionalAreaIdRaw === "" ? null : functionalAreaIdRaw;
  const linkCount =
    (priorityId ? 1 : 0) + (issueId ? 1 : 0) + (functionalAreaId ? 1 : 0);
  if (linkCount > 1) {
    return {
      ok: false,
      message: "Pick just one link (priority, issue, or functional area).",
    };
  }
  const description = String(formData.get("description") ?? "").trim();
  const weekEndingRaw = String(formData.get("week_ending") ?? "").trim();
  const dueDateRaw = String(formData.get("due_date") ?? "").trim();
  const ownerIdRaw = String(formData.get("owner_id") ?? "").trim();
  const isOngoing = String(formData.get("is_ongoing") ?? "") === "true";

  if (!description) {
    return { ok: false, message: "Say what the commitment is." };
  }
  const dueDate = dueDateRaw || weekEndingRaw;
  if (!dueDate) {
    return { ok: false, message: "Pick a due date." };
  }
  const weekEnding = fridayOf(dueDate);

  const supabase = await createSupabaseServerClient();

  let companyId: string | null;
  if (priorityId) {
    const { data: priority } = await supabase
      .from("priorities")
      .select("id, company_id")
      .eq("id", priorityId)
      .maybeSingle<Pick<Priority, "id" | "company_id">>();
    if (!priority) {
      return { ok: false, message: "That action isn't accessible." };
    }
    companyId = priority.company_id;
  } else if (issueId) {
    // The issue-scoped inline add row on /issues writes here. Derive
    // company from the issue and check that the caller can edit the
    // issue itself (creator OR admin OR guide) — the constraint is
    // that "issue commitments are born in context," so issue edit
    // rights gate the create.
    const { data: issue } = await supabase
      .from("issues")
      .select("id, company_id, created_by")
      .eq("id", issueId)
      .maybeSingle<{
        id: string;
        company_id: string;
        created_by: string | null;
      }>();
    if (!issue) {
      return { ok: false, message: "That issue isn't accessible." };
    }
    const canEditIssue =
      isAdminForCompany(session.profile, issue.company_id) ||
      issue.created_by === session.profile.id;
    if (!canEditIssue) {
      return {
        ok: false,
        message: "Only the issue's creator or an admin can add commitments to it.",
      };
    }
    companyId = issue.company_id;
  } else if (functionalAreaId) {
    const { data: fn } = await supabase
      .from("functions")
      .select("id, company_id")
      .eq("id", functionalAreaId)
      .maybeSingle<{ id: string; company_id: string }>();
    if (!fn) {
      return { ok: false, message: "That functional area isn't accessible." };
    }
    companyId = fn.company_id;
  } else {
    companyId = await getEffectiveCompanyId(session);
    if (!companyId) {
      return { ok: false, message: "Pick a company scope first." };
    }
  }

  const isAdmin = isAdminForCompany(session.profile, companyId);
  const ownerId = isAdmin && ownerIdRaw ? ownerIdRaw : session.profile.id;

  const { data, error } = await supabase
    .from("commitments")
    .insert({
      company_id: companyId,
      priority_id: priorityId,
      issue_id: issueId,
      functional_area_id: functionalAreaId,
      owner_id: ownerId,
      description,
      week_ending: weekEnding,
      due_date: dueDate,
      status: "open",
      is_ongoing: isOngoing,
    })
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't save that commitment." };
  }

  let finalRow: Commitment = data;
  try {
    const score = await scoreCommitmentClarity(description, dueDate);
    if (score) {
      const { data: updated } = await supabase
        .from("commitments")
        .update({
          clarity_timeline: score.timeline,
          clarity_success: score.success,
          clarity_note: score.note,
        })
        .eq("id", data.id)
        .select("*")
        .single<Commitment>();
      if (updated) finalRow = updated;
    }
  } catch (err) {
    console.warn("Clarity autoscore failed for commitment", data.id, err);
  }

  revalidateCommitmentSurfaces(priorityId);
  if (issueId) revalidatePath("/issues");
  trackAfter(
    session.profile.id,
    "commitment.created",
    {
      has_priority: Boolean(finalRow.priority_id),
      has_issue: Boolean(finalRow.issue_id),
      has_functional_area: Boolean(finalRow.functional_area_id),
      is_ongoing: finalRow.is_ongoing,
      for_self: finalRow.owner_id === session.profile.id,
    },
    { company: finalRow.company_id }
    );
  return { ok: true, commitment: finalRow };
}

// ---- Mark kept (on time OR late) ------------------------------
// Single entry point for both cases. The server decides on-time vs
// late by comparing due_date to today in the company timezone.
//
// Options:
//   reason:    optional. Owners can skip when late; admins never need
//              one. Empty string / null is treated as "no reason."
//   resolveAs: 'on_time' | 'late'. ADMIN-ONLY override for cases where
//              a coach is retroactively recording resolutions and
//              wants to force the classification. Non-admin callers
//              passing this are silently ignored (server decides).
//
// For ongoing commitments: writes a row to commitment_occurrences
// for the current week_ending, then rolls the commitments row's
// due_date and week_ending forward 7 days. The commitments row
// itself stays 'open'.
export async function markKeptAction(
  commitmentId: string,
  options?: { reason?: string | null; resolveAs?: "on_time" | "late" }
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  const role = resolverRoleFor(session.profile, commitment);
  if (!role) return { ok: false, message: "Not yours to resolve." };
  if (commitment.status !== "open") {
    return { ok: false, message: "That commitment isn't open anymore." };
  }
  if (commitment.parked_at !== null) {
    return {
      ok: false,
      message: "This commitment is in the parking lot — bring it back first.",
    };
  }

  const tz = await getCompanyTimezone(supabase, commitment.company_id);
  const { iso: todayIso } = todayInTimezone(tz);

  // Determine on-time vs late.
  //   - Non-admin: server decides based on due_date vs today.
  //   - Admin: may override via options.resolveAs to force one or the
  //     other (retroactive corrections during coaching).
  const derived: "on_time" | "late" =
    commitment.due_date >= todayIso ? "on_time" : "late";
  const resolveAs: "on_time" | "late" = isAdminOrGuide(role)
    ? (options?.resolveAs ?? derived)
    : derived;
  const newStatus =
    resolveAs === "on_time" ? "kept_on_time" : "kept_late";

  // Reason handling. Non-admin late keeps may include an optional
  // reason from the ghost-skip prompt; on-time keeps don't collect
  // one. Admins never need one but may attach anyway.
  const trimmedReason =
    typeof options?.reason === "string" && options.reason.trim().length > 0
      ? options.reason.trim()
      : null;

  const now = new Date().toISOString();

  // Ongoing rows: record the occurrence, roll forward, keep row open.
  if (commitment.is_ongoing) {
    const rolled = await recordOngoingResolution(supabase, commitment, {
      status: newStatus,
      resolvedAt: now,
      resolverProfileId: session.profile.id,
      resolverRole: role,
      reason: trimmedReason,
    });
    if (!rolled.ok) return rolled;
    revalidateCommitmentSurfaces(commitment.priority_id);
    trackAfter(
      session.profile.id,
      "commitment.marked_kept",
      {
        was_late: newStatus === "kept_late",
        resolver_role: role,
        had_reason: Boolean(trimmedReason),
        is_ongoing: true,
      },
      { company: commitment.company_id }
      );
    return { ok: true, commitment: rolled.commitment };
  }

  // One-shot commitment: update the row itself.
  const { data, error } = await supabase
    .from("commitments")
    .update({
      status: newStatus,
      completed_at: now,
      missed_reason: trimmedReason,
      resolved_by_role: role,
      resolved_by_profile_id: session.profile.id,
    })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't mark that kept." };
  }

  revalidateCommitmentSurfaces(commitment.priority_id);
  trackAfter(
    session.profile.id,
    "commitment.marked_kept",
    {
      was_late: newStatus === "kept_late",
      resolver_role: role,
      had_reason: Boolean(trimmedReason),
      is_ongoing: false,
    },
    { company: commitment.company_id }
    );
  return { ok: true, commitment: data };
}

// ---- Unmark kept (revert one-shot commitment to open) ---------
// Only applies to non-ongoing commitments. Ongoing "unmark" would
// mean deleting the most recent occurrence and rolling the due_date
// back; not spec'd in this build.
export async function unmarkKeptAction(
  commitmentId: string
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!canWriteOwnedRow(session.profile, commitment)) {
    return { ok: false, message: "Not yours to change." };
  }
  if (
    commitment.status !== "kept_on_time" &&
    commitment.status !== "kept_late"
  ) {
    return { ok: false, message: "Only kept commitments can be reverted." };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({
      status: "open",
      completed_at: null,
      missed_reason: null,
      resolved_by_role: null,
      resolved_by_profile_id: null,
    })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't revert that commitment." };
  }

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: data };
}

// ---- Missed --------------------------------------------------
// Owners must supply a reason; admins + guides are exempt (typically
// resolving during the weekly meeting).
export async function markMissedAction(
  commitmentId: string,
  reason: string | null
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  const role = resolverRoleFor(session.profile, commitment);
  if (!role) return { ok: false, message: "Not yours to resolve." };
  if (commitment.status !== "open") {
    return { ok: false, message: "That commitment isn't open anymore." };
  }
  if (commitment.parked_at !== null) {
    return {
      ok: false,
      message: "This commitment is in the parking lot — bring it back first.",
    };
  }

  const trimmedReason =
    typeof reason === "string" && reason.trim().length > 0
      ? reason.trim()
      : null;

  // Owners: reason required. Admins/guides: exempt.
  if (!isAdminOrGuide(role) && !trimmedReason) {
    return {
      ok: false,
      message: "Add a short reason so the pattern is visible over time.",
    };
  }

  const now = new Date().toISOString();

  if (commitment.is_ongoing) {
    const rolled = await recordOngoingResolution(supabase, commitment, {
      status: "missed",
      resolvedAt: now,
      resolverProfileId: session.profile.id,
      resolverRole: role,
      reason: trimmedReason,
    });
    if (!rolled.ok) return rolled;
    revalidateCommitmentSurfaces(commitment.priority_id);
    trackAfter(
      session.profile.id,
      "commitment.marked_missed",
      {
        resolver_role: role,
        had_reason: Boolean(trimmedReason),
        is_ongoing: true,
      },
      { company: commitment.company_id }
      );
    return { ok: true, commitment: rolled.commitment };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({
      status: "missed",
      missed_reason: trimmedReason,
      completed_at: now,
      resolved_by_role: role,
      resolved_by_profile_id: session.profile.id,
    })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) return { ok: false, message: "Couldn't close that." };

  revalidateCommitmentSurfaces(commitment.priority_id);
  trackAfter(
    session.profile.id,
    "commitment.marked_missed",
    {
      resolver_role: role,
      had_reason: Boolean(trimmedReason),
      is_ongoing: false,
    },
    { company: commitment.company_id }
    );
  return { ok: true, commitment: data };
}

// ---- Unmark missed (revert Closed → Open) ---------------------
export async function unmarkMissedAction(
  commitmentId: string
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!canWriteOwnedRow(session.profile, commitment)) {
    return { ok: false, message: "Not yours to change." };
  }
  if (commitment.status !== "missed") {
    return {
      ok: false,
      message: "Only missed commitments can be reopened this way.",
    };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({
      status: "open",
      missed_reason: null,
      completed_at: null,
      resolved_by_role: null,
      resolved_by_profile_id: null,
    })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't reopen that commitment." };
  }

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: data };
}

// ---- Reschedule ----------------------------------------------
// Owners need a reason; admins/guides are exempt and may change any
// date including past-due ones (retroactive corrections happen).
export async function rescheduleCommitmentAction(
  commitmentId: string,
  newDueDate: string,
  reason: string | null
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const trimmedDate = newDueDate.trim();
  if (!trimmedDate) {
    return { ok: false, message: "Pick a new due date." };
  }

  const supabase = await createSupabaseServerClient();
  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  const role = resolverRoleFor(session.profile, commitment);
  if (!role) return { ok: false, message: "Not yours to change." };
  if (commitment.status !== "open") {
    return { ok: false, message: "Only open commitments can be rescheduled." };
  }
  if (commitment.parked_at !== null) {
    return {
      ok: false,
      message: "Parked commitments don't have a schedule — bring it back first.",
    };
  }

  const trimmedReason =
    typeof reason === "string" && reason.trim().length > 0
      ? reason.trim()
      : null;

  if (!isAdminOrGuide(role) && !trimmedReason) {
    return {
      ok: false,
      message: "Add a short reason so the pattern is visible over time.",
    };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({
      due_date: trimmedDate,
      week_ending: fridayOf(trimmedDate),
      // Reason stored in the audit column when supplied; may be null
      // for admin-driven reschedules with no reason attached.
      missed_reason: trimmedReason,
    })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't reschedule that commitment." };
  }

  revalidateCommitmentSurfaces(commitment.priority_id);
  const daysMoved = Math.round(
    (Date.parse(trimmedDate) - Date.parse(commitment.due_date)) /
      (24 * 60 * 60 * 1000)
  );
  trackAfter(
    session.profile.id,
    "commitment.rescheduled",
    {
      days_moved: daysMoved,
      resolver_role: role,
      had_reason: Boolean(trimmedReason),
    },
    { company: commitment.company_id }
    );
  return { ok: true, commitment: data };
}

// ---- Park / unpark -------------------------------------------
// Park clears the due date and hides the row from every metric,
// overdue count, and Needs Attention grouping. Bring back nulls
// parked_at and sets a fresh due_date. No reason on either side.
export async function parkCommitmentAction(
  commitmentId: string
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!canWriteOwnedRow(session.profile, commitment)) {
    return { ok: false, message: "Not yours to park." };
  }
  if (commitment.status !== "open") {
    return { ok: false, message: "Only open commitments can be parked." };
  }
  if (commitment.parked_at !== null) {
    return { ok: true, commitment };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({ parked_at: new Date().toISOString() })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't park that commitment." };
  }

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: data };
}

export async function unparkCommitmentAction(
  commitmentId: string,
  newDueDate: string
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const trimmedDate = newDueDate.trim();
  if (!trimmedDate) {
    return { ok: false, message: "Pick a due date to bring it back." };
  }

  const supabase = await createSupabaseServerClient();
  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!canWriteOwnedRow(session.profile, commitment)) {
    return { ok: false, message: "Not yours to bring back." };
  }
  if (commitment.parked_at === null) {
    return { ok: true, commitment };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({
      parked_at: null,
      due_date: trimmedDate,
      week_ending: fridayOf(trimmedDate),
    })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't bring that back." };
  }

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: data };
}

// ---- Stop repeating (ongoing → normal) ----------------------
// Converts an ongoing commitment into a one-shot due at its current
// date. Owner or admin may invoke.
export async function stopRepeatingAction(
  commitmentId: string
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!canWriteOwnedRow(session.profile, commitment)) {
    return { ok: false, message: "Not yours to change." };
  }
  if (!commitment.is_ongoing) {
    return { ok: true, commitment };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({ is_ongoing: false })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't stop the cycle." };
  }

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: data };
}

// ---- Reassign owner ------------------------------------------
export async function reassignCommitmentAction(
  commitmentId: string,
  newOwnerId: string
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };

  const isClaimForSelf =
    commitment.owner_id === null &&
    newOwnerId === session.profile.id &&
    commitment.company_id === session.profile.company_id;
  if (!isClaimForSelf && !canWriteOwnedRow(session.profile, commitment)) {
    return { ok: false, message: "Not yours to reassign." };
  }
  if (!newOwnerId) {
    return { ok: false, message: "Pick who owns this now." };
  }
  if (newOwnerId === commitment.owner_id) {
    return { ok: true, commitment };
  }

  const { data: newOwner } = await supabase
    .from("profiles")
    .select("id, company_id, status, role")
    .eq("id", newOwnerId)
    .maybeSingle<{
      id: string;
      company_id: string | null;
      status: string;
      role: string;
    }>();
  if (!newOwner) {
    return { ok: false, message: "That person isn't in this company." };
  }
  const isCoach = newOwner.role === "system_admin";
  if (!isCoach && newOwner.company_id !== commitment.company_id) {
    return { ok: false, message: "That person isn't in this company." };
  }
  if (newOwner.status === "inactive") {
    return { ok: false, message: "That person is inactive." };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({ owner_id: newOwnerId })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't reassign that commitment." };
  }

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: data };
}

// ---- Link / unlink priority ---------------------------------
export async function linkPriorityAction(
  commitmentId: string,
  priorityId: string | null
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!canWriteOwnedRow(session.profile, commitment)) {
    return { ok: false, message: "Not yours to change." };
  }
  if (commitment.status !== "open") {
    return {
      ok: false,
      message:
        "Resolved commitments have already fed action progress — their link is frozen.",
    };
  }

  if (priorityId) {
    const { data: priority } = await supabase
      .from("priorities")
      .select("id, company_id, quarter_id")
      .eq("id", priorityId)
      .maybeSingle<Pick<Priority, "id" | "company_id" | "quarter_id">>();
    if (!priority || priority.company_id !== commitment.company_id) {
      return { ok: false, message: "That action isn't accessible." };
    }
    const { data: quarter } = await supabase
      .from("quarters")
      .select("status")
      .eq("id", priority.quarter_id)
      .maybeSingle<{ status: string }>();
    if (quarter?.status !== "open") {
      return {
        ok: false,
        message: "Only actions in the open quarter can be linked.",
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
  // Only fire when the link actually changed (Link + Unlink + Move).
  // Skips no-op saves from the picker.
  if (previousPriorityId !== priorityId) {
    trackAfter(
      session.profile.id,
      "commitment.linked_to_priority",
      {
        action:
          priorityId === null
            ? "unlinked"
            : previousPriorityId === null
              ? "linked"
              : "moved",
      },
      { company: commitment.company_id }
      );
  }
  return { ok: true, commitment: data };
}

// ---- Link switcher (LinkChip's write path) ------------------
// One action for all three link changes (priority / functional
// area / none). Enforces the same rules as linkPriorityAction —
// open-only, owner-or-admin — plus:
//   * Mutual exclusion: sets exactly the chosen link column,
//     clears the other two.
//   * Priority target: validates the priority belongs to the
//     commitment's company and sits in the open quarter (matches
//     the existing linkPriorityAction rule).
//   * Functional area target: validates the function belongs to
//     the commitment's company.
//   * "issue" is NOT a valid target — issue commitments are
//     created from /issues in context and can't be switched INTO
//     via the chip menu. An existing issue-linked commitment CAN
//     be switched away (to priority, functional area, or none).

export type LinkTarget =
  | { type: "priority"; id: string }
  | { type: "functional_area"; id: string }
  | { type: "none" };

export async function changeCommitmentLinkAction(
  commitmentId: string,
  target: LinkTarget
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!canWriteOwnedRow(session.profile, commitment)) {
    return { ok: false, message: "Not yours to change." };
  }
  if (commitment.status !== "open") {
    return {
      ok: false,
      message:
        "Resolved commitments have already fed action progress — their link is frozen.",
    };
  }

  let priorityId: string | null = null;
  let functionalAreaId: string | null = null;
  if (target.type === "priority") {
    const { data: priority } = await supabase
      .from("priorities")
      .select("id, company_id, quarter_id")
      .eq("id", target.id)
      .maybeSingle<Pick<Priority, "id" | "company_id" | "quarter_id">>();
    if (!priority || priority.company_id !== commitment.company_id) {
      return { ok: false, message: "That action isn't accessible." };
    }
    const { data: quarter } = await supabase
      .from("quarters")
      .select("status")
      .eq("id", priority.quarter_id)
      .maybeSingle<{ status: string }>();
    if (quarter?.status !== "open") {
      return {
        ok: false,
        message: "Only actions in the open quarter can be linked.",
      };
    }
    priorityId = target.id;
  } else if (target.type === "functional_area") {
    const { data: fn } = await supabase
      .from("functions")
      .select("id, company_id, archived")
      .eq("id", target.id)
      .maybeSingle<{ id: string; company_id: string; archived: boolean }>();
    if (
      !fn ||
      fn.company_id !== commitment.company_id ||
      fn.archived
    ) {
      return { ok: false, message: "That functional area isn't accessible." };
    }
    functionalAreaId = target.id;
  }

  const previousPriorityId = commitment.priority_id;
  const previousIssueId = commitment.issue_id;
  const { data, error } = await supabase
    .from("commitments")
    .update({
      priority_id: priorityId,
      issue_id: null,
      functional_area_id: functionalAreaId,
    })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't update the link." };
  }

  revalidateCommitmentSurfaces(previousPriorityId);
  revalidateCommitmentSurfaces(priorityId);
  if (previousIssueId) revalidatePath("/issues");
  trackAfter(
    session.profile.id,
    "commitment.link_changed",
    {
      to: target.type,
      from_priority: Boolean(previousPriorityId),
      from_issue: Boolean(previousIssueId),
      from_functional_area: Boolean(commitment.functional_area_id),
    },
    { company: commitment.company_id }
  );
  return { ok: true, commitment: data };
}

// ---- Clarity assessment -------------------------------------
export type ClarityInput = {
  timeline: boolean | null;
  success: boolean | null;
  note: string | null;
};

export async function setCommitmentClarityAction(
  commitmentId: string,
  input: ClarityInput
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!canWriteOwnedRow(session.profile, commitment)) {
    return { ok: false, message: "Not yours to change." };
  }

  const trimmedNote =
    typeof input.note === "string" ? input.note.trim().slice(0, 500) : null;

  const { data, error } = await supabase
    .from("commitments")
    .update({
      clarity_timeline: input.timeline,
      clarity_success: input.success,
      clarity_note: trimmedNote && trimmedNote.length > 0 ? trimmedNote : null,
    })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't update clarity." };
  }

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: data };
}

// ---- Edit description ---------------------------------------
export async function updateCommitmentDescriptionAction(
  commitmentId: string,
  description: string
): Promise<CommitmentResult> {
  const session = await requireProfile();
  const trimmed = description.trim();
  if (!trimmed) {
    return { ok: false, message: "Description can't be empty." };
  }

  const supabase = await createSupabaseServerClient();
  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };
  if (!canWriteOwnedRow(session.profile, commitment)) {
    return { ok: false, message: "Not yours to edit." };
  }

  const { data, error } = await supabase
    .from("commitments")
    .update({ description: trimmed })
    .eq("id", commitmentId)
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't save that change." };
  }

  let finalRow: Commitment = data;
  try {
    const score = await scoreCommitmentClarity(trimmed, data.due_date);
    if (score) {
      const { data: rescored } = await supabase
        .from("commitments")
        .update({
          clarity_timeline: score.timeline,
          clarity_success: score.success,
          clarity_note: score.note,
        })
        .eq("id", data.id)
        .select("*")
        .single<Commitment>();
      if (rescored) finalRow = rescored;
    }
  } catch (err) {
    console.warn(
      "Clarity autoscore failed after description edit for commitment",
      data.id,
      err
    );
  }

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true, commitment: finalRow };
}

// ---- Delete (soft) ------------------------------------------
// Sets deleted_at rather than removing the row. Filtered from every
// UI + metric. INTENTIONALLY REVERSIBLE — retained so future
// coaching signals (churn, abandonment patterns) can be built if
// wanted. No user-facing recovery UI in this build.
export async function deleteCommitmentAction(
  commitmentId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const commitment = await loadCommitment(supabase, commitmentId);
  if (!commitment) return { ok: false, message: "Commitment not found." };

  const isAdmin = isAdminForCompany(session.profile, commitment.company_id);
  if (!isAdmin) {
    if (commitment.owner_id !== session.profile.id) {
      return { ok: false, message: "Not yours to delete." };
    }
    if (commitment.status !== "open") {
      return {
        ok: false,
        message:
          "Resolved commitments stay in history — they can't be deleted.",
      };
    }
  }

  const { error } = await supabase
    .from("commitments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commitmentId);
  if (error) return { ok: false, message: "Couldn't delete that commitment." };

  revalidateCommitmentSurfaces(commitment.priority_id);
  return { ok: true };
}

// ---- Ongoing helpers ----------------------------------------
// Records a per-week occurrence + rolls the commitment row's
// due_date and week_ending forward 7 days. Idempotent per week via
// the unique (commitment_id, week_ending) constraint — a second
// call for the same week upserts in place. The commitments row
// itself stays 'open' the whole time.
async function recordOngoingResolution(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  commitment: Commitment,
  input: {
    status: "kept_on_time" | "kept_late" | "missed";
    resolvedAt: string;
    resolverProfileId: string;
    resolverRole: CommitmentResolverRole;
    reason: string | null;
  }
): Promise<CommitmentResult> {
  const currentWeekEnding = commitment.week_ending;

  const { error: occErr } = await supabase
    .from("commitment_occurrences")
    .upsert(
      {
        commitment_id: commitment.id,
        week_ending: currentWeekEnding,
        status: input.status,
        missed_reason: input.reason,
        resolved_at: input.resolvedAt,
        resolved_by_profile_id: input.resolverProfileId,
        resolved_by_role: input.resolverRole,
      } satisfies Partial<CommitmentOccurrence> & {
        commitment_id: string;
        week_ending: string;
        status: "kept_on_time" | "kept_late" | "missed";
      },
      { onConflict: "commitment_id,week_ending" }
    );
  if (occErr) {
    return { ok: false, message: "Couldn't record the weekly resolution." };
  }

  // Roll the commitment forward one week — new due_date is +7 days,
  // new week_ending is +7 days. The row itself stays 'open' so it
  // keeps appearing in the weekly flow.
  const nextDueDate = addDaysIso(commitment.due_date, 7);
  const nextWeekEnding = addDaysIso(currentWeekEnding, 7);
  const { data: rolled, error: rollErr } = await supabase
    .from("commitments")
    .update({
      due_date: nextDueDate,
      week_ending: nextWeekEnding,
    })
    .eq("id", commitment.id)
    .select("*")
    .single<Commitment>();
  if (rollErr || !rolled) {
    return { ok: false, message: "Couldn't roll the ongoing forward." };
  }
  return { ok: true, commitment: rolled };
}
