import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { computeFollowThroughRate } from "@/lib/utils";
import type { Commitment, Profile } from "@/lib/types";

// Builds the <partner_context> block for a practice session that
// names a co-worker via partner_profile_id.
//
// The allow-list is intentionally narrow and enforced BY THIS
// FUNCTION, not by the caller: the practice may talk about a peer,
// but it must never see that peer's strengths data, missed reasons,
// coaching threads, or any other private surface. If you ever add a
// field here, ask whether the practice — which is often a peer
// talking about a peer — should really be seeing it.
//
// Allowed fields:
//   * full name
//   * position
//   * reporting relationship relative to the caller (manager /
//     direct report / peer / other) — inferred from profiles.reports_to
//   * open commitments: description + due date only (NO missed_reason)
//   * current-quarter follow-through rate as a single percentage
//
// Deliberately NOT included:
//   * strengths data (any table under user_strengths / strengths_*)
//   * coaching_conversations / coaching_messages
//   * closed-late commitments and their verbatim missed_reason
//   * priorities / goals ownership
//   * any per-quarter historical rates
//
// Missing partner or DB errors return null so prompt assembly can
// simply omit the block rather than fail the turn.

export type PartnerContextInput = {
  callerProfileId: string;
  companyId: string;
  partnerProfileId: string;
};

export async function buildPartnerContext(
  input: PartnerContextInput
): Promise<string | null> {
  if (input.partnerProfileId === input.callerProfileId) return null;

  const supabase = await createSupabaseServerClient();

  const { data: partner } = await supabase
    .from("profiles")
    .select("id, full_name, position, company_id, reports_to")
    .eq("id", input.partnerProfileId)
    .maybeSingle<
      Pick<Profile, "id" | "full_name" | "position" | "company_id" | "reports_to">
    >();
  if (!partner) return null;
  // Practices are always in-company: partner must be in the caller's
  // company. This is a defensive check; the action that sets
  // partner_profile_id validates the same thing.
  if (partner.company_id !== input.companyId) return null;

  const { data: caller } = await supabase
    .from("profiles")
    .select("id, reports_to")
    .eq("id", input.callerProfileId)
    .maybeSingle<Pick<Profile, "id" | "reports_to">>();

  const relationship = describeRelationship({
    callerId: input.callerProfileId,
    callerReportsTo: caller?.reports_to ?? null,
    partnerId: partner.id,
    partnerReportsTo: partner.reports_to,
  });

  const openQuarter = await getCurrentQuarter(input.companyId);

  // Two lightweight queries in parallel — one for open commitments
  // (title + due date, no reason) and one for this-quarter status
  // counts (to compute the follow-through rate).
  const [{ data: openRows }, statusRows] = await Promise.all([
    supabase
      .from("commitments")
      .select("description, due_date")
      .eq("owner_id", partner.id)
      .eq("status", "open")
      .order("due_date", { ascending: true }),
    openQuarter
      ? supabase
          .from("commitments")
          .select("status")
          .eq("owner_id", partner.id)
          .gte("week_ending", openQuarter.start_date)
          .lte("week_ending", openQuarter.end_date)
      : Promise.resolve({ data: [] as Array<{ status: string }> }),
  ]);

  const openCommitments = (openRows ?? []) as Array<
    Pick<Commitment, "description" | "due_date">
  >;
  const followThroughRate = computeFollowThroughRate(
    ((statusRows.data ?? []) as Array<{ status: string }>).map((r) => r.status)
  );

  return formatPartnerContext({
    fullName: partner.full_name,
    position: partner.position,
    relationship,
    openCommitments,
    followThroughRate,
    quarterLabel: openQuarter?.label ?? null,
  });
}

// Pure string formatter for <partner_context>. Kept separate from
// the DB query so the allow-list can be unit-tested without mocking
// Supabase. If you're tempted to add a field here, add it to
// FormatPartnerContextInput and update the test — the test is what
// enforces the allow-list.
export type FormatPartnerContextInput = {
  fullName: string;
  position: string | null;
  relationship: string;
  openCommitments: ReadonlyArray<Pick<Commitment, "description" | "due_date">>;
  followThroughRate: number | null;
  quarterLabel: string | null;
};

export function formatPartnerContext(input: FormatPartnerContextInput): string {
  const lines: string[] = ["<partner_context>"];
  lines.push(`Name: ${input.fullName}`);
  lines.push(`Position: ${input.position?.trim() || "(not on file)"}`);
  lines.push(`Reporting relationship to the participant: ${input.relationship}`);

  lines.push("");
  lines.push("Open commitments (due date · description):");
  if (input.openCommitments.length === 0) {
    lines.push("- (none open)");
  } else {
    for (const c of input.openCommitments) {
      lines.push(`- ${c.due_date} · ${c.description.trim()}`);
    }
  }

  lines.push("");
  if (input.quarterLabel) {
    const rate =
      input.followThroughRate === null
        ? "not enough data"
        : `${input.followThroughRate}%`;
    lines.push(
      `Follow-through rate this quarter (${input.quarterLabel}): ${rate}`
    );
  } else {
    lines.push("Follow-through rate this quarter: no open quarter on file");
  }

  lines.push(
    "This is all the platform data available for this person. No strengths, no coaching notes, no missed-commitment reasons. Do not invent details beyond what is listed."
  );
  lines.push("</partner_context>");
  return lines.join("\n");
}

function describeRelationship(args: {
  callerId: string;
  callerReportsTo: string | null;
  partnerId: string;
  partnerReportsTo: string | null;
}): string {
  if (args.partnerReportsTo === args.callerId) return "direct report";
  if (args.callerReportsTo === args.partnerId) return "manager";
  return "peer or other";
}
