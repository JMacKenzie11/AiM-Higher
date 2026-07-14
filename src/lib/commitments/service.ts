import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Commitment, Profile } from "@/lib/types";

export type CommitmentWithOwner = Commitment & {
  owner: Pick<Profile, "id" | "full_name"> | null;
};

export type WeekGroup = {
  weekEnding: string;
  commitments: CommitmentWithOwner[];
};

// Load a priority's full commitment history, grouped by week_ending
// descending. Used by the Priority detail page (Section 8.3).

export async function getCommitmentHistoryForPriority(
  priorityId: string
): Promise<WeekGroup[]> {
  const supabase = await createSupabaseServerClient();

  const { data: commitments } = await supabase
    .from("commitments")
    .select("*")
    .eq("priority_id", priorityId)
    .order("week_ending", { ascending: false })
    .order("created_at", { ascending: true });

  const rows = (commitments ?? []) as Commitment[];
  if (rows.length === 0) return [];

  const ownerIds = Array.from(new Set(rows.map((row) => row.owner_id)));
  const { data: owners } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ownerIds);
  const ownerById = new Map(
    (owners ?? []).map((owner) => [owner.id, owner as Pick<Profile, "id" | "full_name">])
  );

  const grouped = new Map<string, CommitmentWithOwner[]>();
  for (const row of rows) {
    const enriched: CommitmentWithOwner = {
      ...row,
      owner: ownerById.get(row.owner_id) ?? null,
    };
    if (!grouped.has(row.week_ending)) grouped.set(row.week_ending, []);
    grouped.get(row.week_ending)!.push(enriched);
  }

  return Array.from(grouped.entries()).map(([weekEnding, commitments]) => ({
    weekEnding,
    commitments,
  }));
}
