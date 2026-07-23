import { redirect } from "next/navigation";

// /scorecard was superseded by /chart. Migration 0019 backfilled every
// functional_area into a top-level function and every scorecard_metric
// into a success measure under a "General" outcome. Old sibling files
// (AddAreaForm, AddMetricForm, ScorecardCell) are no longer rendered
// because this file is the only entry point; they can be deleted in a
// follow-up cleanup once no external links reference them.
export default function ScorecardRedirect(): never {
  redirect("/chart");
}
