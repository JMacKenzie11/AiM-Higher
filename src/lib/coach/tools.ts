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

export async function buildCoachTools(args: {
  // Nullable — general-mode ("Ask Aimee") conversations have no
  // subject. Subject-scoped tools (strengths) are only registered
  // when a subject id is present; company-scoped tools (classroom)
  // are registered in both modes as long as the feature is on.
  subjectProfileId: string | null;
  companyId: string;
}): Promise<CoachTool[]> {
  const tools: CoachTool[] = [];
  if (args.subjectProfileId) {
    tools.push(
      makeGetStrengthsProfileTool({
        subjectProfileId: args.subjectProfileId,
        companyId: args.companyId,
      })
    );
  }
  // Classroom is company-scoped: the tool doesn't care whether the
  // conversation is about a specific person, only whether the caller's
  // company has the feature. Registering the tool unconditionally
  // would let the model call it and get an "unavailable" response
  // every time — cheaper to just not tell the model it exists.
  if (await companyHasFeature(args.companyId, "classroom")) {
    tools.push(makeSearchClassroomTool());
  }
  return tools;
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

// ---- search_classroom -----------------------------------------
// Returns matching lessons + trainings for a keyword query so Aimee
// can recommend a training when a coaching conversation touches
// something the library covers. Only registered when the caller's
// company has the 'classroom' feature — the LLM never sees the tool
// otherwise. Read RLS on classroom_lessons + classroom_trainings
// enforces the flag defensively too.

const CLASSROOM_MAX_RESULTS = 6;

function makeSearchClassroomTool(): CoachTool {
  return {
    definition: {
      name: "search_classroom",
      description:
        "Search the shared Classroom library for lessons and trainings that match a topic the user is asking about. Returns up to a handful of matches with title, category, a short description, and a stable URL you can link to. Only use when the topic is genuinely covered by a training — if nothing relevant is returned, don't invent one. When you recommend a training, link to its URL and briefly say why it's a fit.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Free-text search — a phrase describing what the user needs help with (e.g. 'running a productive weekly meeting', 'setting quarterly priorities').",
          },
        },
        required: ["query"],
      },
    },
    handler: async (input) => {
      const query =
        typeof (input as { query?: unknown })?.query === "string"
          ? ((input as { query: string }).query as string).trim()
          : "";
      if (!query) return { status: "empty" as const, results: [] };

      // Sanitize for ILIKE — escape % and _ so the model can't
      // construct wildcard queries. Trim to a sensible length so a
      // pasted essay doesn't torch the query.
      const sanitized = query.replace(/[\%_]/g, "\\$&").slice(0, 120);
      const pattern = `%${sanitized}%`;

      const supabase = await createSupabaseServerClient();

      // Lesson matches on title + description; training matches on
      // title. Two round trips keep the SQL simple and readable, and
      // let RLS gate published rows automatically.
      const [{ data: lessons }, { data: trainings }] = await Promise.all([
        supabase
          .from("classroom_lessons")
          .select("title, slug, description")
          .or(`title.ilike.${pattern},description.ilike.${pattern}`)
          .limit(CLASSROOM_MAX_RESULTS),
        supabase
          .from("classroom_trainings")
          .select("title, slug, lesson_id")
          .ilike("title", pattern)
          .limit(CLASSROOM_MAX_RESULTS),
      ]);

      const lessonResults = ((lessons ?? []) as Array<{
        title: string;
        slug: string;
        description: string | null;
      }>).map((l) => ({
        kind: "lesson" as const,
        title: l.title,
        description: l.description,
        url: `/classroom/lessons/${l.slug}`,
      }));

      const trainingResults = ((trainings ?? []) as Array<{
        title: string;
        slug: string;
      }>).map((t) => ({
        kind: "training" as const,
        title: t.title,
        description: null,
        url: `/classroom/trainings/${t.slug}`,
      }));

      const combined = [...lessonResults, ...trainingResults].slice(
        0,
        CLASSROOM_MAX_RESULTS
      );
      return {
        status: combined.length > 0 ? ("ok" as const) : ("empty" as const),
        results: combined,
      };
    },
  };
}
