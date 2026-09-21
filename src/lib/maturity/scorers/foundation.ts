import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";

// Foundation score = how completed the One-Page Plan surface is.
// 2.5 points each for: purpose statement, vision, ≥3 core values,
// ≥3 differentiators. Max 10.
//
// IT WAS FIVE CRITERIA AT 2 POINTS. The fifth was ≥3 key success
// metrics, and the card that collected them was removed from
// /foundation on 2026-09-21 — the company's numbers live on
// /measures as Critical Success Factors, and the One-Page Plan
// version was a second place to keep the same thing.
//
// Leaving the criterion in place would have capped every company at
// 8/10 forever, on a surface with no way to earn the other two. The
// weight is redistributed rather than dropped: four criteria, equal
// weight, still out of 10. clampScore rounds to one decimal and other
// scorers already return fractions, so 2.5 needs nothing special.
//
// Companies that had filled the metrics card in keep their 10. Ones
// that had everything BUT it move from 8 to 10, which is the point:
// they had completed the surface as it now exists.
//
// Rows of kind `key_success_metric` are untouched in the database and
// are simply no longer read.
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

  const points =
    (hasPurpose ? 2.5 : 0) +
    (hasVision ? 2.5 : 0) +
    (values >= 3 ? 2.5 : 0) +
    (differentiators >= 3 ? 2.5 : 0);

  return {
    key: "foundation",
    score: clampScore(points),
    breakdown: {
      purpose: hasPurpose,
      vision: hasVision,
      values,
      differentiators,
    },
  };
}
