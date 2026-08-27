"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { trackAfter } from "@/lib/analytics/track";
import type { Issue } from "@/lib/types";

// Server actions for the Issues/Solutions page. Edit rights follow
// the same pattern as commitments: creator OR company_admin
// (matching company) OR system_admin OR is_guide_for. Rank changes
// share this scope so anyone with edit rights can reorder — the
// order is company-wide, not per-user.

export type IssueResult =
  | { ok: true; issue: Issue }
  | { ok: false; message: string };

async function loadIssue(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  id: string
): Promise<Issue | null> {
  const { data } = await supabase
    .from("issues")
    .select("*")
    .eq("id", id)
    .maybeSingle<Issue>();
  return data ?? null;
}

function canEditIssue(
  profile: Awaited<ReturnType<typeof requireProfile>>["profile"],
  issue: Pick<Issue, "company_id" | "created_by">
): boolean {
  if (isAdminForCompany(profile, issue.company_id)) return true;
  return issue.created_by === profile.id;
}

// ---- Create ---------------------------------------------------
// Any company member may create an issue. New issues land at the
// bottom of the open rank (max(rank) + 1). Source meeting id is
// optional; set by the meeting-summary "Add to open issues" flow
// added in Phase 3.
export async function createIssueAction(
  _prev: IssueResult | undefined,
  formData: FormData
): Promise<IssueResult> {
  const session = await requireProfile();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    return { ok: false, message: "Name the issue plainly." };
  }
  if (title.length > 200) {
    return { ok: false, message: "Keep the issue title under 200 characters." };
  }
  const desiredOutcomeRaw = String(formData.get("desired_outcome") ?? "").trim();
  const desiredOutcome = desiredOutcomeRaw === "" ? null : desiredOutcomeRaw;
  const sourceMeetingIdRaw = String(
    formData.get("source_meeting_id") ?? ""
  ).trim();
  const sourceMeetingId =
    sourceMeetingIdRaw === "" ? null : sourceMeetingIdRaw;

  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) {
    return { ok: false, message: "Pick a company scope first." };
  }

  const supabase = await createSupabaseServerClient();

  // Land at the bottom of the open list.
  const { data: rankRow } = await supabase
    .from("issues")
    .select("rank")
    .eq("company_id", companyId)
    .eq("status", "open")
    .order("rank", { ascending: false })
    .limit(1)
    .maybeSingle<{ rank: number }>();
  const nextRank = (rankRow?.rank ?? -1) + 1;

  const { data, error } = await supabase
    .from("issues")
    .insert({
      company_id: companyId,
      title,
      desired_outcome: desiredOutcome,
      rank: nextRank,
      source_meeting_id: sourceMeetingId,
      created_by: session.profile.id,
    })
    .select("*")
    .single<Issue>();
  if (error || !data) {
    return { ok: false, message: "Couldn't save that issue." };
  }

  revalidatePath("/issues");
  trackAfter(
    session.profile.id,
    "issue.created",
    { from_meeting: Boolean(sourceMeetingId) },
    { company: data.company_id }
  );
  return { ok: true, issue: data };
}

// ---- Rename (inline title edit) -------------------------------
export async function renameIssueAction(
  id: string,
  newTitle: string
): Promise<IssueResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const issue = await loadIssue(supabase, id);
  if (!issue) return { ok: false, message: "Issue not found." };
  if (!canEditIssue(session.profile, issue)) {
    return { ok: false, message: "You can't edit that issue." };
  }
  const title = newTitle.trim();
  if (!title) return { ok: false, message: "Title can't be empty." };
  if (title.length > 200) {
    return { ok: false, message: "Keep the title under 200 characters." };
  }

  const { data, error } = await supabase
    .from("issues")
    .update({ title })
    .eq("id", id)
    .select("*")
    .single<Issue>();
  if (error || !data) {
    return { ok: false, message: "Couldn't save that change." };
  }
  revalidatePath("/issues");
  return { ok: true, issue: data };
}

// ---- Update desired_outcome (inline "WHAT WE WANT" edit) ------
export async function updateIssueDesiredOutcomeAction(
  id: string,
  value: string
): Promise<IssueResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const issue = await loadIssue(supabase, id);
  if (!issue) return { ok: false, message: "Issue not found." };
  if (!canEditIssue(session.profile, issue)) {
    return { ok: false, message: "You can't edit that issue." };
  }
  const trimmed = value.trim();
  const desired = trimmed === "" ? null : trimmed;

  const { data, error } = await supabase
    .from("issues")
    .update({ desired_outcome: desired })
    .eq("id", id)
    .select("*")
    .single<Issue>();
  if (error || !data) {
    return { ok: false, message: "Couldn't save that change." };
  }
  revalidatePath("/issues");
  return { ok: true, issue: data };
}

// ---- Resolve --------------------------------------------------
// Sets status='resolved' + resolved_at. Deliberately does NOT
// touch the issue's open commitments — those stay live and
// resolvable via the normal commitment flows on personal surfaces
// (Guide HQ my commitments, coaching context) even after the
// parent issue closes.
export async function resolveIssueAction(id: string): Promise<IssueResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const issue = await loadIssue(supabase, id);
  if (!issue) return { ok: false, message: "Issue not found." };
  if (!canEditIssue(session.profile, issue)) {
    return { ok: false, message: "You can't resolve that issue." };
  }
  if (issue.status === "resolved") {
    return { ok: true, issue };
  }

  const { data, error } = await supabase
    .from("issues")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single<Issue>();
  if (error || !data) {
    return { ok: false, message: "Couldn't resolve that issue." };
  }
  revalidatePath("/issues");
  trackAfter(
    session.profile.id,
    "issue.resolved",
    {},
    { company: data.company_id }
  );
  return { ok: true, issue: data };
}

// ---- Delete ---------------------------------------------------
// Admin/guide-only hard delete. Issues don't carry a deleted_at
// column (see migration 0143 — the design was intentional; a
// mis-named issue should disappear cleanly rather than linger as
// tombstone data), so this is a real DELETE. Any linked
// commitments' issue_id is set null automatically via the FK
// (`on delete set null` in migration 0143), so the commitments
// stay live and just lose the issue linkage.
//
// Uses the admin client for the actual DELETE. Migration 0143
// explicitly ships no DELETE RLS policy on issues (comment: "No
// delete policy — issues archive by transitioning to
// status='resolved'"). Now that admins can delete, RLS would
// silently reject with 0 rows affected and no error, and the
// action would return ok:true while nothing changed. Admin
// client bypasses RLS; the isAdminForCompany check above is the
// enforcement point.
export async function deleteIssueAction(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();
  const issue = await loadIssue(supabase, id);
  if (!issue) return { ok: false, message: "Issue not found." };
  if (!isAdminForCompany(session.profile, issue.company_id)) {
    return {
      ok: false,
      message: "Only admins and guides can delete issues.",
    };
  }

  const admin = createSupabaseAdminClient();
  const { error, count } = await admin
    .from("issues")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't delete that issue." };
  // Defensive: even the admin client can return 0 rows if the id
  // vanished between the load above and this delete (a race with
  // another admin, or a cascade elsewhere). Surface that instead
  // of pretending it succeeded.
  if (count === 0) {
    return { ok: false, message: "That issue is already gone." };
  }

  revalidatePath("/issues");
  trackAfter(
    session.profile.id,
    "issue.deleted",
    {},
    { company: issue.company_id }
  );
  return { ok: true };
}

// ---- Reorder --------------------------------------------------
// Reorder the entire open list. Takes the full ordered id array
// after a drag; server rewrites rank on all open issues so the
// order is stable and shared company-wide. Any caller with edit
// rights on at least one of the issues may reorder (checked
// against the first issue as a proxy — all issues in the list
// share a company, and RLS enforces the actual write scope).
export async function reorderIssuesAction(
  orderedIds: string[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireProfile();
  if (orderedIds.length === 0) return { ok: true };

  const supabase = await createSupabaseServerClient();
  const first = await loadIssue(supabase, orderedIds[0]!);
  if (!first) return { ok: false, message: "Issue not found." };
  if (!canEditIssue(session.profile, first)) {
    return { ok: false, message: "You can't reorder issues here." };
  }

  // Fire every rank rewrite in parallel — the previous serial
  // for-loop blocked the drag persist on N round-trips (~50-100ms
  // each). Rank writes on different rows are independent, so
  // Promise.all lets the connection pool absorb them concurrently.
  // Each row still goes through RLS on its own; a batch upsert
  // would need an RPC to avoid the NOT NULL columns issue and the
  // parallel path is enough at v1 volumes.
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("issues").update({ rank: i }).eq("id", id)
    )
  );
  for (const { error } of results) {
    if (error) {
      return { ok: false, message: "Couldn't save the new order." };
    }
  }

  revalidatePath("/issues");
  return { ok: true };
}
