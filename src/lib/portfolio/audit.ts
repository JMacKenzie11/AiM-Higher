import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import type { SessionProfileLike } from "@/lib/auth/permissions";

// The accountability layer for portfolio_admin.
//
// WHY THIS EXISTS AT ALL. aims_guide reach is a row in
// guide_assignments: to ask "was this person allowed in that company",
// you read the table. portfolio_admin reach is instance-wide by
// construction, so there is no such row and never will be — that was
// the design decision, and this is the thing that pays for it. Every
// scope-in and every administrative write leaves a record naming who,
// what, which company and when.
//
// WRITTEN BY THE ACTION LAYER, and that is a compromise worth naming
// rather than hiding. company_feature_events (0173) and
// company_settings_events (0189) are trigger-written precisely so a
// caller who forgets cannot skip them. Two of the actions here cannot
// be: "scoped in" is not a row change in any table, and "invited a
// user" happens through the service-role client, where a trigger
// cannot tell a portfolio_admin from provisioning.
//
// What backs it up instead is the RLS policy on the table:
// portfolio_admin_events_insert admits only a portfolio_admin writing
// a row about THEMSELVES. So the action layer cannot forge a row
// against somebody else, and nothing else can write here at all.
// There is no UPDATE or DELETE policy for any role, so a row that
// lands stays.

export type PortfolioAction =
  | "scoped_in"
  | "company_created"
  | "company_settings_changed"
  | "company_archived"
  | "company_unarchived"
  | "feature_enabled"
  | "feature_disabled"
  | "user_invited"
  // Giving yourself a company, and giving it up. Decision 2 allows a
  // portfolio admin to assign themselves any company on the
  // instance, and requires the arrangement be "recorded, visible,
  // and never silent" — the card shipped visible and not recorded.
  | "company_access_granted"
  | "company_access_revoked";

// Fire-and-report, never throw.
//
// The audit write must not be able to fail the thing it is recording.
// A portfolio_admin who creates a company and then sees an error
// because the log insert bounced would reasonably try again, and the
// second attempt makes a second company. So a failure here is logged
// to the server and swallowed, and the caller's result is unchanged.
//
// The honest cost: a dropped event is invisible to the user. That is
// the right trade for a log that sits beside the action rather than
// inside its transaction, and it is why the two logs that CAN be
// trigger-written are.
export async function recordPortfolioEvent(opts: {
  profile: SessionProfileLike;
  action: PortfolioAction;
  companyId: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  // Only this role is audited here, and the RLS policy agrees: an
  // insert from anyone else is refused rather than silently stored.
  // Returning early keeps a system_admin's ordinary work out of a
  // table that is about one role's reach.
  if (opts.profile.role !== "portfolio_admin") return;

  try {
    const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
    const { error } = await supabase.from("portfolio_admin_events").insert({
      actor_id: opts.profile.id,
      action: opts.action,
      company_id: opts.companyId,
      detail: opts.detail ?? {},
    });
    if (error) {
      console.error("recordPortfolioEvent: insert failed", {
        action: opts.action,
        companyId: opts.companyId,
        supabaseError: error,
      });
    }
  } catch (err) {
    console.error("recordPortfolioEvent: threw", {
      action: opts.action,
      companyId: opts.companyId,
      err,
    });
  }
}
