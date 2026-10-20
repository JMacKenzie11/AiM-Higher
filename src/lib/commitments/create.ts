import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { trackAfter } from "@/lib/analytics/track";
import { isAdminForCompany } from "@/lib/auth/permissions";
import type { requireProfile, SessionProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAssignablePeople } from "@/lib/people/assignable";
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
//
// TWO LAYERS. insertCommitment is the rules and the write, on a client
// it is handed, for a person and a company it is told: nothing in it
// reads a cookie or a request. createCommitment is the app's wrapper:
// it builds the cookie client, resolves the scoped company when
// nothing else names one, and refreshes the pages and records the
// event after a save. A caller outside a page request (an outside
// assistant acting as the person) uses insertCommitment on a client
// signed in as that person, so the same rules run.

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
  // Someone else on the company's roster, for an admin of it or anyone
  // in it (0293); unset, or anyone else, owns it themselves.
  ownerId?: string | null;
  isOngoing?: boolean;
  // The company the commitment belongs to when nothing linked says so.
  // Unset: the caller's current scope. Set: a link to another company
  // is refused.
  companyId?: string | null;
  // The Aimee message whose card it was saved from (0255).
  coachingMessageId?: string | null;
  // Score clarity BEFORE the insert and write it with the row, instead
  // of updating the row after. Same scorer, same inputs, same columns.
  // For an outside assistant, which may add a commitment but never
  // update one (0270), so the after-insert update would be refused and
  // the commitment left unassessed.
  clarityBeforeInsert?: boolean;
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

// Who is writing, and on which client. The client must be signed in
// as `profile`: the insert rules on commitments see that session, and
// `profile` decides only what the app checks before asking them.
export type CommitmentWriter = {
  db: SupabaseClient;
  profile: SessionProfile;
};

export async function createCommitment(
  session: Awaited<ReturnType<typeof requireProfile>>,
  input: NewCommitment
): Promise<CommitmentResult> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  // The scoped company stands in only when nothing linked names one,
  // as it always has: a link decides its own company.
  const linked = Boolean(input.priorityId || input.issueId || input.functionalAreaId);
  const fallbackCompanyId =
    input.companyId || linked ? null : await getEffectiveCompanyId(session);
  const result = await insertCommitment({ db, profile: session.profile }, input, fallbackCompanyId);
  if (!result.ok) return result;

  const row = result.commitment;
  revalidateCommitmentSurfaces(row.priority_id, row.issue_id);
  trackAfter(
    session.profile.id,
    "commitment.created",
    {
      has_priority: Boolean(row.priority_id),
      has_issue: Boolean(row.issue_id),
      has_functional_area: Boolean(row.functional_area_id),
      is_ongoing: row.is_ongoing,
      for_self: row.owner_id === session.profile.id,
      from_aimee: Boolean(input.coachingMessageId),
    },
    { company: row.company_id }
  );
  return result;
}

// The rules and the write. `fallbackCompanyId` is the company used
// when neither a link nor input.companyId names one; input.companyId,
// when set, must agree with any link.
export async function insertCommitment(
  writer: CommitmentWriter,
  input: NewCommitment,
  fallbackCompanyId: string | null = null
): Promise<CommitmentResult> {
  const { db: supabase, profile } = writer;
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
      isAdminForCompany(profile, issue.company_id) ||
      issue.created_by === profile.id;
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
    companyId = input.companyId ?? fallbackCompanyId;
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

  // Who owns it. An admin for the company, or anyone in it, may name
  // someone else on its roster (Jason, 2026-10-20; RLS 0293, which
  // says the same). Anyone else, a portfolio admin not switched on as
  // the company's admin among them, owns what they add.
  const isAdmin = isAdminForCompany(profile, companyId);
  const mayAssign = isAdmin || profile.company_id === companyId;
  let ownerId = profile.id;
  if (mayAssign && input.ownerId && input.ownerId !== profile.id) {
    const roster = await getAssignablePeople(supabase, companyId);
    if (!roster.some((p) => p.id === input.ownerId)) {
      return { ok: false, message: "That person isn't on this company's team." };
    }
    ownerId = input.ownerId;
  }
  // Once saved, a commitment for someone else is theirs, and only they
  // or an admin may change it: so its clarity is scored with the insert,
  // as for an outside assistant, not written by an update after it.
  const scoreFirst = input.clarityBeforeInsert || (ownerId !== profile.id && !isAdmin);

  let preScore: Awaited<ReturnType<typeof scoreCommitmentClarity>> = null;
  if (scoreFirst) {
    try {
      preScore = await scoreCommitmentClarity(description, dueDate);
    } catch (err) {
      console.warn("Clarity autoscore failed before insert", err);
    }
  }

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
      ...(preScore
        ? { clarity_timeline: preScore.timeline, clarity_success: preScore.success, clarity_note: preScore.note }
        : {}),
    })
    .select("*")
    .single<Commitment>();
  if (error || !data) {
    return { ok: false, message: "Couldn't save that commitment." };
  }

  let finalRow: Commitment = data;
  if (scoreFirst) return { ok: true, commitment: finalRow };
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

  return { ok: true, commitment: finalRow };
}
