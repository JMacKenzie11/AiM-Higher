import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Subscription-gate helpers. NavBand + module pages call these to
// decide what's visible for a given company. Feature strings are
// intentionally open — the DB has no CHECK constraint — so a new
// module can ship without a migration to add its name here.

export type ModuleFeature =
  | "execution"
  | "strengths"
  // Opt-in performance tracking. When on:
  //   - success-measure targets are required
  //   - the Saturday cron fires "update the measure" commitments
  //     for missed weekly logs
  //   - dashboards surface generative operational-performance cards
  | "performance_tracking"
  // Opt-in facilitation review. When on, each new meeting transcript
  // gets a second LLM pass that scores how the meeting was run against
  // the AiMS Weekly Leadership Meeting framework. The review is stored
  // on meeting_analyses.facilitation_review_json and rendered as a
  // coaching-tone panel on the meeting detail page + a signal chip on
  // the list. Doubles per-meeting LLM cost — off by default.
  | "meeting_facilitation_review"
  // Opt-in shared training library. When on, users get a Classroom
  // nav item leading to lessons and video trainings authored by AiMS
  // system admins. Aimee also gets a search_classroom tool so she can
  // recommend a training in conversation. Content is shared across
  // every flag-enabled company — there is no per-company copy.
  | "classroom"
  // Opt-in AiMS role-description generator. When on, /chart/function/[id]
  // exposes a "Complete this function" interview that walks any gaps
  // in the Function's outcomes / measures / decision rights /
  // competency indicators, then renders a publishable role
  // description with draft + version history.
  | "role_descriptions";

// Entitlements read through a client the CALLER supplies.
//
// Use this, not getCompanyFeatures() below, from any code that can run
// without a user session: crons, the transcript pipeline, anything
// inside the instance fan-out. Pass that context's service-role
// client.
//
// The reason is that the wrong choice fails silently rather than
// loudly. getCompanyFeatures() reads through the cookie-scoped client,
// which resolves to the `anon` Postgres role when no session cookie is
// present. Every policy on company_features is `to authenticated`
// (migration 0016), so `anon` matches none of them and the read comes
// back EMPTY rather than erroring. The caller then sees a company with
// no entitlements at all and takes the "feature is off" branch
// everywhere, which looks exactly like a customer who never bought the
// module.
//
// That is not hypothetical. The weekly scorecard cron resolved flags
// this way from 2026-08-13 until this fix and recorded all four
// feature-gated disciplines as "not enabled" for every company on
// every snapshot it ever wrote. Nothing showed it: /scorecard computes
// live through a client that does carry a session, so the page was
// right while the history behind it was wrong.
//
// The same shape already exists twice for the same reason — see
// companyHasFacilitationReview in src/lib/transcripts/analyze.ts and
// the company_features read in the performance cron.
export async function getCompanyFeaturesWith(
  db: SupabaseClient,
  companyId: string
): Promise<ModuleFeature[]> {
  const { data, error } = await db
    .from("company_features")
    .select("feature")
    .eq("company_id", companyId);
  if (error) {
    // Logged, because the bug this replaces was silent. "No
    // entitlements" and "the read failed" produce the same value here
    // and must not produce the same signal. Still non-fatal: a
    // scorecard with a missing tile beats a cron that dies.
    console.error(
      `[features] entitlement read failed for company ${companyId}: ${error.message}`
    );
  }
  return ((data ?? []) as Array<{ feature: string }>).map(
    (row) => row.feature as ModuleFeature
  );
}

// Wrapped in React's cache() so a company's entitlements are read
// ONCE per request no matter how many callers ask. They were being
// re-fetched constantly: the (app) layout reads them, the page reads
// them again via companyHasFeature, and computeCompanyScorecard asks
// twice more per company — which on Guide HQ multiplied by the whole
// caseload. Per-request and per-render, so no cross-tenant sharing.
//
// REQUEST-SCOPED ONLY. This resolves the caller's own session from
// cookies, so it is meaningless outside a request and empty (not an
// error) without one. Background work uses getCompanyFeaturesWith.
export const getCompanyFeatures = cache(async function getCompanyFeatures(
  companyId: string
): Promise<ModuleFeature[]> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  return getCompanyFeaturesWith(supabase, companyId);
});

export async function companyHasFeature(
  companyId: string,
  feature: ModuleFeature
): Promise<boolean> {
  const features = await getCompanyFeatures(companyId);
  return features.includes(feature);
}
