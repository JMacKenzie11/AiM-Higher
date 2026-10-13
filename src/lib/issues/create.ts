import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionProfile } from "@/lib/auth/current-user";
import type { Issue } from "@/lib/types";

// RAISING AN ISSUE: the rules and the write, on a client it is handed.
//
// createIssueAction (actions.ts) is the Issues page's wrapper: it reads
// the form and the scoped company, then refreshes the page and records
// the event after a save. Nothing here reads a cookie or a request, so
// a caller outside a page request (an outside assistant acting as the
// person) raises an issue through the same rules on a client signed in
// as that person. The insert rules on issues are the boundary, and the
// database stamps created_by from that session (0268).

export type IssueResult =
  | { ok: true; issue: Issue }
  | { ok: false; message: string };

export type NewIssue = {
  title: string;
  desiredOutcome?: string | null;
  sourceMeetingId?: string | null;
};

// The client must be signed in as `profile`.
export type IssueWriter = {
  db: SupabaseClient;
  profile: SessionProfile;
};

// Any company member may raise an issue. It lands at the bottom of the
// open rank (max(rank) + 1).
export async function insertIssue(
  writer: IssueWriter,
  companyId: string | null,
  input: NewIssue
): Promise<IssueResult> {
  const title = input.title.trim();
  if (!title) {
    return { ok: false, message: "Name the issue plainly." };
  }
  if (title.length > 200) {
    return { ok: false, message: "Keep the issue title under 200 characters." };
  }
  const desiredOutcomeRaw = (input.desiredOutcome ?? "").trim();
  const desiredOutcome = desiredOutcomeRaw === "" ? null : desiredOutcomeRaw;
  const sourceMeetingIdRaw = (input.sourceMeetingId ?? "").trim();
  const sourceMeetingId = sourceMeetingIdRaw === "" ? null : sourceMeetingIdRaw;

  if (!companyId) {
    return { ok: false, message: "Pick a company scope first." };
  }

  const { db: supabase, profile } = writer;

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
      created_by: profile.id,
    })
    .select("*")
    .single<Issue>();
  if (error || !data) {
    return { ok: false, message: "Couldn't save that issue." };
  }
  return { ok: true, issue: data };
}
