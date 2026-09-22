import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { getFoundation } from "@/lib/foundation/service";
import { orderFunctionsByHierarchy } from "@/lib/measures/spine";
import type { CoachTool } from "@/lib/coach/tools";

// Read-only tools for the Role Description Builder.
//
// ============================================================
// SCOPE BOUNDARY, and it is deliberate.
//
// Both tools read the SHARED COMPANY RECORD: the Foundation and the
// Functional Chart. Both are already on screen for anybody holding
// this conversation, at /foundation and /chart.
//
// NOTHING here reads `coaching_conversations`, `coaching_messages`,
// or anything derived from a conversation, for the same reason
// coach/history-tools.ts does not. Whether an agent should be able
// to read what was said in other sessions is a real question with
// consent and confidentiality consequences, and adding such a read
// here would answer it by accident.
//
// Nothing here reads anything about a PERSON either, beyond the name
// in a seat. The agent writes a description of a ROLE. Who might
// hold it is a different document and a different conversation, and
// the prompt says so out loud.
// ============================================================
//
// RLS APPLIES. Every query runs on the CALLER'S client, never the
// service client, so a tool returns exactly what the person holding
// the conversation could already see in the product. Failure mode E5
// held forward: app-layer guards are courtesy, the policy is the
// boundary, and a tool reaching for createSupabaseAdminClient would
// silently widen visibility for every role at once.
//
// The company id is CLOSED OVER, not a parameter. Neither tool takes
// an identifier of any kind. RLS would refuse a cross-tenant read
// anyway, but "the model cannot name a company" is a stronger and
// cheaper property than "the database will catch it".
//
// Tools never throw. An empty Foundation is a documented shape, not
// an error, so the model can say "there is nothing here yet" and
// offer to work from what the leader tells it instead.

export function buildRoleDescriptionTools(args: {
  companyId: string;
}): CoachTool[] {
  return [makeGetFoundationTool(args), makeListFunctionsTool(args)];
}

// ---- get_foundation -------------------------------------------

function makeGetFoundationTool(args: { companyId: string }): CoachTool {
  return {
    definition: {
      name: "get_foundation",
      description:
        "The company's Foundation: name, industry, purpose (statement and context), vision, core values and differentiators. " +
        "Call this before the first question. Use it to anchor why this role exists, why it matters, and what excellence looks like against each value. " +
        "Every section is always present: a section the company has not filled in comes back as null or an empty array, never missing. An empty Foundation is not an error — say so in one sentence, point at /foundation, and carry on from what the leader tells you.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const db = await createSupabaseServerClient(getCurrentInstanceConfig());

      // Reused rather than re-queried: getFoundation is what
      // /foundation renders from, so the values this agent writes
      // against cannot drift from the ones the leader is looking at.
      // It fetches the marketing tables too, which this tool drops.
      const [{ data: company }, foundation] = await Promise.all([
        db
          .from("companies")
          .select("name, industry")
          .eq("id", args.companyId)
          .maybeSingle<{ name: string | null; industry: string | null }>(),
        getFoundation(args.companyId),
      ]);

      return {
        status: "ok" as const,
        company_name: company?.name ?? null,
        industry: company?.industry ?? null,
        purpose: {
          statement: foundation.foundation?.purpose_statement ?? null,
          context: foundation.foundation?.purpose_context ?? null,
        },
        vision: foundation.foundation?.vision ?? null,
        core_values: foundation.coreValues.map((v) => ({
          title: v.title,
          body: v.body ?? null,
        })),
        differentiators: foundation.differentiators.map((d) => ({
          title: d.title,
          body: d.body ?? null,
        })),
      };
    },
  };
}

// ---- list_functions -------------------------------------------

type FunctionRow = {
  id: string;
  title: string;
  description: string | null;
  parent_function_id: string | null;
  sort_order: number;
  lead_id: string | null;
};

function makeListFunctionsTool(args: { companyId: string }): CoachTool {
  return {
    definition: {
      name: "list_functions",
      description:
        "The company's Functional Chart: every function, in chart order, with its Lead, its responsibilities, and its critical success factors. " +
        "Call this before the first question. Use it to show the leader which function this role holds, and to start the responsibilities and critical success factors from what the chart already says rather than from nothing. " +
        "Order is depth-first through the tree with Visionary first and Integrator second, the same order /chart and Critical Success Factors use, so the list reads top-down. " +
        "Every function carries a baseline 'Lead, Track, Decide' responsibility, returned first and flagged; it is part of every seat and you never propose removing it. " +
        "A critical success factor with no target is normal and allowed. Returns status='empty' when the chart has no functions — go straight to the off-chart path.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const db = await createSupabaseServerClient(getCurrentInstanceConfig());

      const { data: fnRows } = await db
        .from("functions")
        .select("id, title, description, parent_function_id, sort_order, lead_id")
        .eq("company_id", args.companyId)
        .eq("archived", false);
      const functions = (fnRows ?? []) as FunctionRow[];
      if (functions.length === 0) {
        return { status: "empty" as const, reason: "no functions on the chart" };
      }

      const ids = functions.map((f) => f.id);
      const leadIds = [
        ...new Set(functions.map((f) => f.lead_id).filter((v): v is string => !!v)),
      ];

      const [{ data: roleRows }, { data: csfRows }, { data: peopleRows }] =
        await Promise.all([
          db
            .from("function_roles")
            .select("id, function_id, title, body, sort_order, is_default")
            .in("function_id", ids)
            // is_default first, then sort_order: the baseline row is
            // sort_order 0 today and the chart does not depend on
            // that, so neither does this.
            .order("is_default", { ascending: false })
            .order("sort_order"),
          db
            .from("success_measures")
            .select(
              "id, function_id, description, target, value_type, target_direction, update_frequency, sort_order"
            )
            .in("function_id", ids)
            .eq("archived", false)
            .order("sort_order"),
          leadIds.length > 0
            ? db.from("profiles").select("id, full_name").in("id", leadIds)
            : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
        ]);

      const roles = (roleRows ?? []) as Array<{
        function_id: string;
        title: string;
        body: string | null;
        is_default: boolean;
      }>;
      const csfs = (csfRows ?? []) as Array<{
        function_id: string;
        description: string;
        target: string | null;
        value_type: string;
        target_direction: string;
        update_frequency: string;
      }>;
      const names = new Map(
        ((peopleRows ?? []) as Array<{ id: string; full_name: string }>).map(
          (p) => [p.id, p.full_name]
        )
      );

      // Reused, not reimplemented: one definition of chart order, so
      // the list the model reads matches the chart the leader is
      // looking at while they answer.
      const ordered = orderFunctionsByHierarchy(functions);

      return {
        status: "ok" as const,
        functions: ordered.map((fn) => ({
          id: fn.id,
          title: fn.title,
          description: fn.description,
          parent_function_id: fn.parent_function_id,
          // The NAME, not the id. The model is writing prose about a
          // reporting line, and an id in that sentence is a bug the
          // leader has to read past.
          lead: fn.lead_id ? names.get(fn.lead_id) ?? null : null,
          responsibilities: roles
            .filter((r) => r.function_id === fn.id)
            .map((r) => ({
              title: r.title,
              body: r.body,
              is_baseline: r.is_default === true,
            })),
          critical_success_factors: csfs
            .filter((c) => c.function_id === fn.id)
            .map((c) => ({
              description: c.description,
              target: c.target,
              value_type: c.value_type,
              target_direction: c.target_direction,
              update_frequency: c.update_frequency,
            })),
        })),
      };
    },
  };
}
