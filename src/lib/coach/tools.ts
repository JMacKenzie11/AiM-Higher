import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { companyHasFeature } from "@/lib/subscriptions/service";

// Coach tools — factory pattern. Every tool is a closure over the
// conversation's subject + company, so the model can never supply
// its own identifiers. The handler is called by the streaming route
// when the model emits a tool_use block; the return value is
// serialized to JSON and fed back as tool_result.
//
// Tools MUST NOT throw for "expected empty" cases (no assessment,
// feature disabled, etc.). Return a documented status shape instead
// so the model can reason about it and, per the coaching prompt
// guardrail, say so honestly rather than invent.

export type CoachTool = {
  definition: Anthropic.Tool;
  handler: (input: unknown) => Promise<unknown>;
};

export function buildCoachTools(args: {
  subjectProfileId: string;
  companyId: string;
}): CoachTool[] {
  return [makeGetStrengthsProfileTool(args)];
}

// ---- get_strengths_profile ------------------------------------
// Returns the subject's completed strengths assessment payload —
// dimensions, sub-strengths (with signature / capable_but_draining
// flags), narrative summary. Feature-gated on company_features.
// Never errors:
//   - { status: "ok", ...data } when the assessment is complete
//   - { status: "incomplete" } when the module is on but the subject
//     hasn't finished the assessment
//   - { status: "unavailable" } when the company doesn't have the
//     strengths module entitlement (block is absent from context
//     for the same reason)

function makeGetStrengthsProfileTool(args: {
  subjectProfileId: string;
  companyId: string;
}): CoachTool {
  return {
    definition: {
      name: "get_strengths_profile",
      description:
        "Fetch the coaching subject's completed strengths assessment. Returns dimensions (competence + energy per dimension), sub-strengths with flags (signature / capable_but_draining / hidden_pull / lower_priority), top strengths, and the written narrative summary. Returns status='incomplete' if the subject has not finished the assessment, or status='unavailable' if the company does not have the strengths module. Never fabricate strengths; if this returns anything other than status='ok', say so honestly.",
      input_schema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    handler: async () => {
      const enabled = await companyHasFeature(args.companyId, "strengths");
      if (!enabled) return { status: "unavailable" as const };

      const supabase = await createSupabaseServerClient();
      const { data: assessment } = await supabase
        .from("strengths_assessments")
        .select("id, completed_at")
        .eq("user_id", args.subjectProfileId)
        .eq("status", "completed")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; completed_at: string | null }>();
      if (!assessment) return { status: "incomplete" as const };

      const { data: result } = await supabase
        .from("strengths_results")
        .select("profile, summary")
        .eq("assessment_id", assessment.id)
        .maybeSingle<{ profile: unknown; summary: string }>();
      if (!result) return { status: "incomplete" as const };

      return {
        status: "ok" as const,
        completed_at: assessment.completed_at,
        profile: result.profile,
        summary: result.summary,
      };
    },
  };
}
