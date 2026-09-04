import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Transition-only glue for phases 3 to 7 of the CSF/KPI migration.
//
// Migration 0166 left both models valid at once. Reads have moved to
// the new shape (measures with a kind, joined by csf_kpi_links) while
// writes still go to function_outcomes, because moving the authoring
// surfaces is phase 5. Without these helpers a newly created outcome
// would never appear as a CSF and the page would silently stop
// showing new work.
//
// Every function here is idempotent and best-effort in the sense that
// it never invents a company: it copies what the outcome row already
// says. All of it is deleted in phase 8 when function_outcomes goes.
//
// Naming note: an outcome's `title` maps to a measure's
// `description`, because that is the field holding a measure's name.
// The outcome's own `description`, its longer text, maps to `detail`.
// Getting that pair backwards silently swaps a name for a paragraph
// on every card.

export type OutcomeRowForMirror = {
  id: string;
  function_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  archived: boolean;
};

// Creates or refreshes the CSF measure that shadows an outcome. The
// measure REUSES the outcome's id, which is what makes this an upsert
// rather than a lookup, and what keeps existing links pointing at the
// right row when a title changes.
export async function mirrorOutcomeToCsf(
  supabase: SupabaseClient,
  outcome: OutcomeRowForMirror
): Promise<void> {
  await supabase.from("success_measures").upsert(
    {
      id: outcome.id,
      outcome_id: null,
      function_id: outcome.function_id,
      kind: "csf",
      description: outcome.title,
      detail: outcome.description,
      sort_order: outcome.sort_order,
      archived: outcome.archived,
      // Migrated and mirrored CSFs never opt themselves into the
      // weekly nudge. Same reasoning as migration 0166: the
      // performance cron would open a "log this week's value"
      // commitment for every one of them.
      auto_track: false,
    },
    { onConflict: "id" }
  );
}

// Keeps a KPI's new-model fields in step with the outcome it was
// created under, and records the link. Safe to call more than once
// for the same pair.
export async function mirrorMeasureToKpi(
  supabase: SupabaseClient,
  args: { measureId: string; outcomeId: string; functionId: string }
): Promise<void> {
  await supabase
    .from("success_measures")
    .update({ kind: "kpi", function_id: args.functionId })
    .eq("id", args.measureId);

  // The outcome id IS the CSF measure id, so no lookup is needed.
  await supabase
    .from("csf_kpi_links")
    .upsert(
      { csf_id: args.outcomeId, kpi_id: args.measureId },
      { onConflict: "csf_id,kpi_id" }
    );
}

// Archiving a CSF archives the KPIs beneath it. This is the rule
// settled on 4 September: without it, archiving an outcome leaves its
// KPIs live but parentless — invisible in the tree while still
// collecting weekly values and still generating cron commitments.
//
// Deliberately NOT symmetric. Un-archiving a CSF does not restore its
// KPIs, because cascading a hide is reversible while cascading an
// un-hide would resurrect measures someone archived on purpose.
export async function cascadeArchiveKpis(
  supabase: SupabaseClient,
  csfId: string
): Promise<number> {
  const { data: links } = await supabase
    .from("csf_kpi_links")
    .select("kpi_id")
    .eq("csf_id", csfId);
  const kpiIds = ((links ?? []) as Array<{ kpi_id: string }>).map(
    (l) => l.kpi_id
  );
  if (kpiIds.length === 0) return 0;

  await supabase
    .from("success_measures")
    .update({ archived: true })
    .in("id", kpiIds);
  return kpiIds.length;
}
