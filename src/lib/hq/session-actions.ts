"use server";

import { requireRole } from "@/lib/auth/current-user";
import { loadRecentBriefs } from "./brief";
import { loadSessionCard, type SessionCard } from "./calls";
import { loadCaseload, loadMyCommitments, type MyCommitmentRow } from "./service";

// "Your next session with {company}" for one company, fetched when a
// company chip is chosen on Coach HQ's Coaching calls tab, so the chip
// no longer reloads the whole page (Jason, 2026-11-17: switching took
// long enough to look broken). Reads only: the same loaders the page
// uses, under the caller's own RLS, and only for a company in the
// caller's own caseload (guide_assignments), as on the page.

export type SessionPanelData = {
  companyId: string;
  card: SessionCard;
  promises: MyCommitmentRow[];
  brief: { id: string; content: string; createdAt: string } | null;
};

export async function loadSessionPanelAction(
  companyId: string
): Promise<{ ok: true; data: SessionPanelData } | { ok: false; error: string }> {
  const session = await requireRole(["aims_guide", "system_admin"]);
  const caseload = await loadCaseload(session.profile.id);
  const company = caseload.find((c) => c.id === companyId);
  if (!company) return { ok: false, error: "That company isn't one you coach." };

  const [card, mine, briefs] = await Promise.all([
    loadSessionCard(company),
    loadMyCommitments(session.profile.id),
    loadRecentBriefs(company.id, 1),
  ]);
  return {
    ok: true,
    data: {
      companyId: company.id,
      card,
      promises: openPromisesFor(mine, company.id),
      brief: briefs[0]
        ? { id: briefs[0].id, content: briefs[0].content_markdown, createdAt: briefs[0].created_at }
        : null,
    },
  };
}

function openPromisesFor(rows: MyCommitmentRow[], companyId: string): MyCommitmentRow[] {
  return rows.filter((c) => c.company_id === companyId && c.status === "open" && !c.deleted_at && !c.parked_at);
}
