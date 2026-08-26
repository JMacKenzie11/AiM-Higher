import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CommitmentWithMeta } from "@/lib/commitments/service";
import type { Commitment, Issue, Profile } from "@/lib/types";

// Reads for the Issues/Solutions page. Open issues rank first (by
// the shared company-wide `rank` field); resolved issues surface
// as a compact list beneath and are expandable read-only. Each
// open issue also carries its issue-linked commitments so the
// page can render the full commitment row treatment inline.
//
// Commitments are enriched to CommitmentWithMeta so CommitmentRow
// (shared with /commitments) doesn't need a variant. Priority is
// always null on issue-linked commitments — the DB constraint
// enforces exclusivity.

export type IssueWithCommitments = Issue & {
  commitments: CommitmentWithMeta[];
};

export type IssuesPageData = {
  open: IssueWithCommitments[];
  // Resolved issues carry the same enriched shape as open so the
  // read-only Resolved section can render the same 5-column row
  // treatment (Issue / What we want / Commitment / Assigned to /
  // Due date) instead of a bare title-plus-meta line.
  resolved: IssueWithCommitments[];
};

export async function getIssuesPageData(
  companyId: string
): Promise<IssuesPageData> {
  const supabase = await createSupabaseServerClient();

  const { data: issueRows } = await supabase
    .from("issues")
    .select("*")
    .eq("company_id", companyId)
    .order("status", { ascending: true })
    .order("rank", { ascending: true })
    .order("created_at", { ascending: false });
  const issues = (issueRows ?? []) as Issue[];

  const openIssues = issues.filter((i) => i.status === "open");
  const resolvedIssues = issues.filter((i) => i.status === "resolved");

  const openIds = openIssues.map((i) => i.id);
  const allIds = issues.map((i) => i.id);

  // Fetch every commitment linked to any of these issues in one
  // round trip. Filter soft-deleted; keep resolved + open so the
  // card can show recent history alongside this week's line.
  // Resolved issues only need a count, not the full rows.
  const { data: commitmentRows } = allIds.length
    ? await supabase
        .from("commitments")
        .select("*")
        .in("issue_id", allIds)
        .is("deleted_at", null)
        .order("due_date", { ascending: true })
    : { data: [] };
  const commitments = (commitmentRows ?? []) as Commitment[];

  // Enrich commitments with owner meta (priority is always null on
  // issue-linked commitments per the check constraint).
  const ownerIds = Array.from(
    new Set(
      commitments
        .map((c) => c.owner_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const { data: ownerRows } = ownerIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, position")
        .in("id", ownerIds)
    : { data: [] };
  const ownerById = new Map(
    ((ownerRows ?? []) as Array<
      Pick<Profile, "id" | "full_name" | "position">
    >).map((o) => [o.id, o])
  );
  // Attach the parent issue as the link meta so LinkChip has
  // something to show on the /issues page (redundant on that
  // page, useful when the same row surfaces in Guide HQ / coach
  // context). Priority + functional_area are always null on
  // issue-linked commitments by DB constraint.
  const issueMetaById = new Map(
    issues.map((i) => [i.id, { id: i.id, title: i.title, status: i.status }])
  );
  const enriched: CommitmentWithMeta[] = commitments.map((c) => ({
    ...c,
    owner: c.owner_id ? (ownerById.get(c.owner_id) ?? null) : null,
    priority: null,
    issue: c.issue_id ? (issueMetaById.get(c.issue_id) ?? null) : null,
    functionalArea: null,
  }));

  const commitmentsByIssue = new Map<string, CommitmentWithMeta[]>();
  for (const c of enriched) {
    if (!c.issue_id) continue;
    const list = commitmentsByIssue.get(c.issue_id) ?? [];
    list.push(c);
    commitmentsByIssue.set(c.issue_id, list);
  }

  const openWithCommitments: IssueWithCommitments[] = openIssues.map((i) => ({
    ...i,
    commitments: commitmentsByIssue.get(i.id) ?? [],
  }));

  const resolvedWithCommitments: IssueWithCommitments[] = resolvedIssues.map(
    (i) => ({
      ...i,
      commitments: commitmentsByIssue.get(i.id) ?? [],
    })
  );

  return { open: openWithCommitments, resolved: resolvedWithCommitments };
}

export async function getIssueById(id: string): Promise<Issue | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("issues")
    .select("*")
    .eq("id", id)
    .maybeSingle<Issue>();
  return data ?? null;
}
