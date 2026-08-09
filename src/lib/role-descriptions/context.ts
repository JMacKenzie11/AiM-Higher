import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CompanyFoundation, FoundationItem } from "@/lib/types";

// Lean context loader for the role-description suggestion service.
// Fetches only what the prompt needs — company foundation blocks and
// the function's own current state. Deliberately not routed through
// buildCoachContext (that loader carries person-level history and
// commitment data the RD prompt doesn't use, and it can't be cheaply
// tree-shaken).

export type FunctionContextSnapshot = {
  functionTitle: string;
  functionDescription: string | null;
  parentTitle: string | null;
  existingResponsibilities: string[]; // non-default function_roles
  existingOutcomes: Array<{ title: string; description: string | null }>;
  existingMeasureCounts: Record<string, number>; // outcome_id -> metric count
  existingDecisionRights: string[];
  existingCompetencies: string[];
};

export type CompanyContextSnapshot = {
  companyName: string;
  purposeStatement: string | null;
  vision: string | null;
  coreValues: FoundationItem[];
  differentiators: FoundationItem[];
};

// Load a fresh snapshot for one function. Called once per Suggest
// button click — cheap enough that we don't need to cache.
export async function loadFunctionContext(
  functionId: string
): Promise<{
  company: CompanyContextSnapshot;
  fn: FunctionContextSnapshot;
} | null> {
  const supabase = await createSupabaseServerClient();

  const { data: fn } = await supabase
    .from("functions")
    .select("id, company_id, title, description, parent_function_id")
    .eq("id", functionId)
    .maybeSingle<{
      id: string;
      company_id: string;
      title: string;
      description: string | null;
      parent_function_id: string | null;
    }>();
  if (!fn) return null;

  const [
    { data: company },
    { data: foundation },
    { data: foundationItems },
    { data: parent },
    { data: rolesRaw },
    { data: outcomesRaw },
    { data: measuresRaw },
    { data: decisionRightsRaw },
    { data: competenciesRaw },
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name")
      .eq("id", fn.company_id)
      .maybeSingle<{ id: string; name: string }>(),
    supabase
      .from("company_foundation")
      .select("*")
      .eq("company_id", fn.company_id)
      .maybeSingle<CompanyFoundation>(),
    supabase
      .from("foundation_items")
      .select("*")
      .eq("company_id", fn.company_id)
      .in("kind", ["core_value", "differentiator"]),
    fn.parent_function_id
      ? supabase
          .from("functions")
          .select("id, title")
          .eq("id", fn.parent_function_id)
          .maybeSingle<{ id: string; title: string }>()
      : Promise.resolve({ data: null }),
    supabase
      .from("function_roles")
      .select("title, is_default")
      .eq("function_id", fn.id)
      .order("sort_order"),
    supabase
      .from("function_outcomes")
      .select("id, title, description")
      .eq("function_id", fn.id)
      .eq("archived", false)
      .order("sort_order"),
    supabase
      .from("success_measures")
      .select("outcome_id")
      .eq("archived", false),
    supabase
      .from("function_decision_rights")
      .select("title")
      .eq("function_id", fn.id)
      .order("sort_order"),
    supabase
      .from("function_competencies")
      .select("title")
      .eq("function_id", fn.id)
      .order("sort_order"),
  ]);

  const items = (foundationItems ?? []) as FoundationItem[];
  const outcomes =
    (outcomesRaw ?? []) as Array<{
      id: string;
      title: string;
      description: string | null;
    }>;
  const measureCounts: Record<string, number> = {};
  for (const row of (measuresRaw ?? []) as Array<{ outcome_id: string }>) {
    measureCounts[row.outcome_id] = (measureCounts[row.outcome_id] ?? 0) + 1;
  }

  return {
    company: {
      companyName: company?.name ?? "(unnamed company)",
      purposeStatement: foundation?.purpose_statement ?? null,
      vision: foundation?.vision ?? null,
      coreValues: items.filter((i) => i.kind === "core_value"),
      differentiators: items.filter((i) => i.kind === "differentiator"),
    },
    fn: {
      functionTitle: fn.title,
      functionDescription: fn.description,
      parentTitle: parent?.title ?? null,
      existingResponsibilities: (
        (rolesRaw ?? []) as Array<{ title: string; is_default: boolean }>
      )
        .filter((r) => !r.is_default)
        .map((r) => r.title),
      existingOutcomes: outcomes.map((o) => ({
        title: o.title,
        description: o.description,
      })),
      existingMeasureCounts: measureCounts,
      existingDecisionRights: (
        (decisionRightsRaw ?? []) as Array<{ title: string }>
      ).map((r) => r.title),
      existingCompetencies: (
        (competenciesRaw ?? []) as Array<{ title: string }>
      ).map((r) => r.title),
    },
  };
}

// Format the two snapshots into the user-message text block that
// travels alongside the system prompt on each recommendation call.
// Kept in this file so context loading and formatting stay in one
// place — the prompt file owns the philosophy, this file owns the
// data shape.
export function formatContextForPrompt(input: {
  target: "outcomes" | "measures" | "decision_rights" | "competencies";
  company: CompanyContextSnapshot;
  fn: FunctionContextSnapshot;
  outcomeTitle?: string; // required when target === "measures"
  outcomeDescription?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`<target>${input.target}</target>`);

  lines.push("<company_context>");
  lines.push(`Name: ${input.company.companyName}`);
  if (input.company.purposeStatement) {
    lines.push("");
    lines.push("Purpose:");
    lines.push(input.company.purposeStatement.trim());
  }
  if (input.company.vision) {
    lines.push("");
    lines.push("Vision:");
    lines.push(input.company.vision.trim());
  }
  if (input.company.coreValues.length > 0) {
    lines.push("");
    lines.push("Core values:");
    for (const cv of input.company.coreValues) {
      const body = cv.body ? ` — ${cv.body.trim()}` : "";
      lines.push(`- ${cv.title.trim()}${body}`);
    }
  }
  if (input.company.differentiators.length > 0) {
    lines.push("");
    lines.push("Differentiators:");
    for (const d of input.company.differentiators) {
      const body = d.body ? ` — ${d.body.trim()}` : "";
      lines.push(`- ${d.title.trim()}${body}`);
    }
  }
  lines.push("</company_context>");

  lines.push("");
  lines.push("<function_context>");
  lines.push(`Function: ${input.fn.functionTitle}`);
  if (input.fn.parentTitle) {
    lines.push(`Sits under: ${input.fn.parentTitle}`);
  }
  if (input.fn.functionDescription) {
    lines.push(`Description: ${input.fn.functionDescription}`);
  }
  if (input.fn.existingResponsibilities.length > 0) {
    lines.push("");
    lines.push("Existing responsibilities (beyond L/T/D):");
    for (const r of input.fn.existingResponsibilities) lines.push(`- ${r}`);
  }
  if (input.fn.existingOutcomes.length > 0) {
    lines.push("");
    lines.push("Existing outcomes:");
    for (const o of input.fn.existingOutcomes) {
      const body = o.description ? ` — ${o.description}` : "";
      lines.push(`- ${o.title}${body}`);
    }
  }
  if (input.fn.existingDecisionRights.length > 0) {
    lines.push("");
    lines.push("Existing decision rights:");
    for (const d of input.fn.existingDecisionRights) lines.push(`- ${d}`);
  }
  if (input.fn.existingCompetencies.length > 0) {
    lines.push("");
    lines.push("Existing competency indicators:");
    for (const c of input.fn.existingCompetencies) lines.push(`- ${c}`);
  }
  if (input.target === "measures" && input.outcomeTitle) {
    lines.push("");
    lines.push("Suggest measures for this outcome specifically:");
    lines.push(`- ${input.outcomeTitle}`);
    if (input.outcomeDescription) {
      lines.push(`  Why it matters: ${input.outcomeDescription}`);
    }
  }
  lines.push("</function_context>");

  lines.push("");
  lines.push(
    "Return three recommendations tailored to this function and company. Do not repeat any option already listed above."
  );

  return lines.join("\n");
}
