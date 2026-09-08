import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/quarters/service";
import type { CurrentSession } from "@/lib/auth/current-user";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Shared "Set up {Company}" checklist step assembly. Called from
// both /dashboard (previously) and /scorecard (canonical home per
// the AiMS Implementation reframe) so the step definitions and
// done-detection live in exactly one place.
//
// Order (reordered from the earlier dashboard version):
//   1. Build the team           — add people + build the chart
//   2. Invite the team          — send invitations
//   3. Open a quarter           — the wrapper every commitment lives in
//   4. Start the weekly rhythm  — a commitment logged in the last 14 days
//   5. Track Issues/Solutions   — an issue logged in the last 14 days
//
// "Build the vision and strategic plan" retired here — the practice
// happens away from the app and the placement misfit was pulling
// attention from the 4 operating disciplines. Vision content still
// lives on /foundation for teams that use it.

export type SetupStep = {
  key: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
};

export type SetupPayload = {
  companyName: string;
  steps: SetupStep[];
  anyIncomplete: boolean;
};

// The three facts the checklist needs, and nothing else.
//
// This used to call getDashboardData, which issues fifteen queries to
// build the whole /dashboard read model — focus areas, sponsors,
// progress rollups, twelve weeks of commitment trend, recent wins and
// their owner and priority lookups. The checklist reads three values
// out of that: the company name, whether a quarter is open, and the
// roster. /scorecard paid for the other twelve on every load, on top
// of its own live scorecard compute.
//
// The roster predicate is deliberately identical to the one in
// getDashboardData (company_id, status <> 'inactive', pending users
// included). Two steps depend on it — "Build the team" counts the
// roster, "Invite the team" compares invited against invitable — so a
// predicate that drifts from the dashboard's would silently change
// when a step ticks. Pinned by a test.
export type SetupFacts = {
  companyName: string;
  openQuarterLabel: string | null;
  rosterIds: string[];
};

export async function loadSetupFacts(
  companyId: string
): Promise<SetupFacts | null> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const [{ data: company }, openQuarter, { data: roster }] = await Promise.all([
    supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle<{ name: string }>(),
    // Already request-memoized, and the only quarter read either
    // surface needs.
    getCurrentQuarter(companyId),
    supabase
      .from("profiles")
      .select("id")
      .eq("company_id", companyId)
      .neq("status", "inactive"),
  ]);

  // A missing company row means there is nothing to set up. Matches
  // what getDashboardData returned for the same condition.
  if (!company) return null;

  return {
    companyName: company.name,
    openQuarterLabel: openQuarter?.label ?? null,
    rosterIds: ((roster ?? []) as Array<{ id: string }>).map((p) => p.id),
  };
}

export async function computeCompanySetup(
  companyId: string,
  callerProfileId: string
): Promise<SetupPayload | null> {
  const facts = await loadSetupFacts(companyId);
  if (!facts) return null;

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  // 14-day window anchored to UTC-ish ISO — cheap cutoff for
  // "activity is happening now, not a stale ping from six months
  // ago." Used by both the rhythm and issues/solutions steps.
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 14);
  const cutoffIso = cutoffDate.toISOString().slice(0, 10);
  const cutoffTimestamp = cutoffDate.toISOString();

  const [
    { count: functionCount },
    { count: invitedCount },
    { count: recentCommitmentCount },
    { count: recentIssueCount },
  ] = await Promise.all([
    supabase
      .from("functions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("archived", false),
    // Profiles with invited_at set — the admin who signed up
    // directly has invited_at=null so they don't count, exactly
    // what we want for "have you invited people yet?"
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .not("invited_at", "is", null),
    // Commitments with week_ending inside the 14-day window.
    // Captures both "just created" and "still on this week's list"
    // — either signals the rhythm is running.
    supabase
      .from("commitments")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("week_ending", cutoffIso),
    // Issues created inside the 14-day window. Any activity here
    // signals the team is naming problems, working solutions, and
    // logging commitments off them — the whole solution-seeking loop.
    supabase
      .from("issues")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("created_at", cutoffTimestamp),
  ]);

  const hasPeople = facts.rosterIds.length > 1; // owner alone doesn't count
  const hasFunction = (functionCount ?? 0) > 0;

  // Total invitable people = roster minus the current admin.
  // If we're a sysadmin scoped into the company, subtracting the
  // current user still lands on the correct count in practice
  // (sysadmins don't have a company_id and won't appear in
  // the roster).
  const invitableTotal = facts.rosterIds.filter(
    (id) => id !== callerProfileId
  ).length;
  const invited = invitedCount ?? 0;
  const allInvited = invitableTotal > 0 && invited >= invitableTotal;
  const inviteDescription =
    invitableTotal === 0
      ? "Send invitations when you're ready. Add people first — then invite them from the People page."
      : allInvited
        ? `Everyone on the roster has been invited (${invited} of ${invitableTotal}).`
        : `${invited} of ${invitableTotal} invited so far. Send the rest from the People page when you're ready.`;

  const hasOpenQuarter = Boolean(facts.openQuarterLabel);
  const quarterDescription = hasOpenQuarter
    ? `Current quarter: ${facts.openQuarterLabel ?? "open"}.`
    : "Open the current quarter so commitments and priorities can live inside it. Company creation seeds one automatically — this step re-opens it if it ever closes.";

  const hasRecentCommitment = (recentCommitmentCount ?? 0) > 0;
  const rhythmDescription = hasRecentCommitment
    ? "Weekly commitments are flowing in — keep the meeting cadence going."
    : "Set this quarter's priorities and run your weekly meeting. Every commitment your team makes lives here.";

  const hasRecentIssue = (recentIssueCount ?? 0) > 0;
  const issuesDescription = hasRecentIssue
    ? "Issues are being surfaced and worked — keep the loop going."
    : "Name what's getting in the way, agree what you want instead, and make commitments to move it forward. Track issues + solutions on the Issues page.";

  const steps: SetupStep[] = [
    {
      key: "team",
      label: "Build the team",
      description:
        "Add your people, build the functional chart, and set critical success factors with the KPIs that drive them. Everything else lands on real names.",
      href: "/people",
      done: hasPeople && hasFunction,
    },
    {
      key: "invite",
      label: "Invite the team",
      description: inviteDescription,
      href: "/people",
      done: allInvited,
    },
    {
      key: "quarter",
      label: "Open a quarter",
      description: quarterDescription,
      href: "/quarters",
      done: hasOpenQuarter,
    },
    {
      key: "rhythm",
      label: "Start the weekly rhythm",
      description: rhythmDescription,
      href: "/commitments",
      done: hasRecentCommitment,
    },
    {
      key: "issues",
      label: "Track Issues / Solutions",
      description: issuesDescription,
      href: "/issues",
      done: hasRecentIssue,
    },
  ];

  return {
    companyName: facts.companyName,
    steps,
    anyIncomplete: steps.some((s) => !s.done),
  };
}

// Convenience wrapper — resolves whether the caller is allowed to
// see the checklist (admin-level authority on the company) and
// bundles the compute + gate in one call so pages don't have to
// duplicate the role check.
export async function loadCompanySetupIfAdmin(
  companyId: string,
  session: CurrentSession,
  isAdminForThisCompany: boolean
): Promise<SetupPayload | null> {
  if (!isAdminForThisCompany || !session.profile) return null;
  const payload = await computeCompanySetup(companyId, session.profile.id);
  return payload;
}
