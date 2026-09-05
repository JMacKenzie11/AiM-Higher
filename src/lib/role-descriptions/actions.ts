"use server";

import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  recommendForFunction,
  type Recommendation,
  type RdTarget,
} from "./recommend";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Server actions the Role Description drawer calls. Only the
// suggestion path lives here — write-backs (Use this / Save) reuse
// the existing chart actions (createOutcomeAction,
// createMeasureAction, createFunctionDecisionRightAction,
// createFunctionCompetencyAction) so there's one insert path per
// table.
//
// Auth: any admin for the function's company can call this — system
// admin, the company_admin whose company_id matches, or an
// aims_guide with the function's company in their assignments.
// Cross-company writes are prevented by RLS on the target chart
// tables (function_outcomes, function_decision_rights, etc.), all
// of which grant guide access via is_guide_for(company_id).

export type SuggestResult =
  | { ok: true; recommendations: Recommendation[] }
  | { ok: false; message: string };

export async function suggestForFunctionAction(input: {
  functionId: string;
  target: RdTarget;
  outcomeId?: string;
}): Promise<SuggestResult> {
  const session = await requireProfile();

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: fn } = await supabase
    .from("functions")
    .select("company_id")
    .eq("id", input.functionId)
    .maybeSingle<{ company_id: string }>();
  if (!fn) return { ok: false, message: "Function not found." };

  if (!isAdminForCompany(session.profile, fn.company_id)) {
    return {
      ok: false,
      message: "You don't have permission to complete this role description.",
    };
  }

  // If the caller asked for measures, resolve the outcome text they
  // want measures for. The recommendation prompt anchors on the
  // outcome title/description so options are specific to it.
  let outcomeTitle: string | undefined;
  let outcomeDescription: string | null | undefined;
  if (input.target === "measures") {
    if (!input.outcomeId) {
      return {
        ok: false,
        message: "Pick which critical success factor the KPIs should serve.",
      };
    }
    // The CSF measure, checked against the function so a caller
    // cannot point this at another function's CSF.
    const { data: outcome } = await supabase
      .from("success_measures")
      .select("description, detail")
      .eq("id", input.outcomeId)
      .eq("function_id", input.functionId)
      .eq("kind", "csf")
      .maybeSingle<{ description: string; detail: string | null }>();
    if (!outcome) {
      return {
        ok: false,
        message: "That critical success factor doesn't belong to this function.",
      };
    }
    outcomeTitle = outcome.description;
    outcomeDescription = outcome.detail;
  }

  const recommendations = await recommendForFunction({
    functionId: input.functionId,
    target: input.target,
    outcomeTitle,
    outcomeDescription,
  });

  return { ok: true, recommendations };
}
