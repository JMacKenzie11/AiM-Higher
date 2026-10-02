import "server-only";

import { revalidatePath } from "next/cache";
import { trackAfter } from "@/lib/analytics/track";
import { isAdminForCompany } from "@/lib/auth/permissions";
import type { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scoreCommitmentClarity } from "./clarity";
import type { Commitment, Priority } from "@/lib/types";
import { addDays, fridayOf, todayInTimezone } from "@/lib/dates";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// CREATING A COMMITMENT: ONE PATH, WHEREVER IT STARTS.
//
// The Commitments page (createCommitmentAction) and Aimee's draft card
// (coach/commitment-offer-actions.ts) both save through here, so a
// commitment saved from a conversation meets exactly the rules one
// added by hand does: the link taxonomy, issue edit rights, who may
// own it, the clarity score, the surfaces revalidated. Under the
// caller's own session, so the insert rules on commitments are the
// boundary.

export type CommitmentResult =
  | { ok: true; commitment: Commitment }
  | { ok: false; message: string };

export type NewCommitment = {
  description: string;
  // Null: nobody named a day. Due a week from today in the company's
  // timezone and marked as a default, so it shows "By next meeting"
  // (commitments/due-label.ts), the way a meeting's commitments do.
  dueDate: string | null;
  priorityId?: string | null;
  issueId?: string | null;
  functionalAreaId?: string | null;
  // Honoured for an admin of the company only; anyone else owns it.
  ownerId?: string | null;
  isOngoing?: boolean;
  // The company the commitment belongs to when nothing linked says so.
  // Unset: the caller's current scope. Set: a link to another company
  // is refused.
  companyId?: string | null;
  // The Aimee message whose card it was saved from (0255).
  coachingMessageId?: string | null;
};

// Every surface a commitment mutation can change.
//
// `issueId` is the second argument and it was missing entirely.
// Create, relink and delete each revalidated /issues by hand; the
// other TEN mutations did not — mark kept, unmark kept, mark missed,
// unmark missed, reschedule, park, unpark, reassign, clarity and
// description. Every one of them changes something the issue card
// renders, so resolving an issue-linked commitment left the Issues
// page showing it as still open until something else happened to
// invalidate the route.
//
// That mattered little when the card showed one commitment and no
// history. It matters now: completing the last open commitment is
// what raises the "did this solve it?" prompt, and a stale page is a
// prompt that never appears.
//
// Taking the id here rather than revalidating /issues unconditionally
// keeps the cost on the rows that have an issue. Most commitments do
// not.
export function revalidateCommitmentSurfaces(
  priorityId: string | null,
  issueId?: string | null
): void {
  revalidatePath("/commitments");
  revalidatePath("/dashboard");
  if (priorityId) revalidatePath(`/plan/priority/${priorityId}`);
  if (issueId) revalidatePath("/issues");
}

export async function createCommitment(
  session: Awaited<ReturnType<typeof requireProfile>>,
  input: NewCommitment
): Promise<CommitmentResult> {
  const priorityId = input.priorityId || null;
  const issueId = input.issueId || null;
  const functionalAreaId = input.functionalAreaId || null;
  const description = input.description.trim();

  // Link taxonomy (per migration 0143): a commitment may carry AT
  // MOST ONE of priority_id / issue_id / functional_area_id. The
  // composer picks one; the DB check constraint is the final gate.
  const linkCount = (priorityId ? 1 : 0) + (issueId ? 1 : 0) + (functionalAreaId ? 1 : 0);
  if (linkCount > 1) {
    return { ok: false, message: "Pick just one link (priority, issue, or functional area)." };
  }
  if (!description) {
    return { ok: false, message: "Say what the commitment is." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

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
    companyId = input.companyId ?? (await getEffectiveCompanyId(session));
    if (!companyId) {
      return { ok: false, message: "Pick a company scope first." };
    }
  }
  if (input.companyId && companyId !== input.companyId) {
    return { ok: false, message: "That link belongs to another company." };
  }

  let dueDate = input.dueDate;
  const dueDateDefaulted = !dueDate;
  if (!dueDate) {
    const { data: company } = await supabase
      .from("companies")
      .select("timezone")
      .eq("id", companyId)
      .maybeSingle<{ timezone: string }>();
    dueDate = addDays(todayInTimezone(company?.timezone ?? "America/Anchorage").iso, 7);
  }
  const weekEnding = fridayOf(dueDate);

  const isAdmin = isAdminForCompany(session.profile, companyId);
  const ownerId = isAdmin && input.ownerId ? input.ownerId : session.profile.id;

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
      is_ongoing: input.isOngoing ?? false,
      ...(dueDateDefaulted ? { due_date_defaulted: true } : {}),
      ...(input.coachingMessageId ? { coaching_message_id: input.coachingMessageId } : {}),
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

  revalidateCommitmentSurfaces(priorityId, issueId);
  trackAfter(
    session.profile.id,
    "commitment.created",
    {
      has_priority: Boolean(finalRow.priority_id),
      has_issue: Boolean(finalRow.issue_id),
      has_functional_area: Boolean(finalRow.functional_area_id),
      is_ongoing: finalRow.is_ongoing,
      for_self: finalRow.owner_id === session.profile.id,
      from_aimee: Boolean(input.coachingMessageId),
    },
    { company: finalRow.company_id }
  );
  return { ok: true, commitment: finalRow };
}
