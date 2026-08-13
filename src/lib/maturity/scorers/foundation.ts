import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";

// Foundation score = how completed the One-Page Plan surface is.
// 2 points each for: purpose statement, vision, ≥3 core values,
// ≥3 differentiators, ≥3 key success metrics. Max 10.
//
// Deliberately doesn't judge the QUALITY of the text — a coach does
// that in conversation. The scorecard only asks whether the surface
// has been filled in.

export async function scoreFoundation(
  admin: SupabaseClient,
  companyId: string
): Promise<DisciplineScore> {
  const [foundationRes, itemsRes] = await Promise.all([
    admin
      .from("company_foundation")
      .select("purpose_statement, vision")
      .eq("company_id", companyId)
      .maybeSingle<{
        purpose_statement: string | null;
        vision: string | null;
      }>(),
    admin
      .from("foundation_items")
      .select("kind")
      .eq("company_id", companyId),
  ]);

  const foundation = foundationRes.data;
  const items = (itemsRes.data ?? []) as Array<{ kind: string }>;

  const hasPurpose = !!foundation?.purpose_statement?.trim();
  const hasVision = !!foundation?.vision?.trim();

  const countByKind = (kind: string) =>
    items.filter((i) => i.kind === kind).length;
  const values = countByKind("core_value");
  const differentiators = countByKind("differentiator");
  const successMetrics = countByKind("key_success_metric");

  const points =
    (hasPurpose ? 2 : 0) +
    (hasVision ? 2 : 0) +
    (values >= 3 ? 2 : 0) +
    (differentiators >= 3 ? 2 : 0) +
    (successMetrics >= 3 ? 2 : 0);

  return {
    key: "foundation",
    score: clampScore(points),
    breakdown: {
      purpose: hasPurpose,
      vision: hasVision,
      values,
      differentiators,
      successMetrics,
    },
  };
}
