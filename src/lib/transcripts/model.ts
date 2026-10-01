// The model that writes a meeting's analysis, and rewords its items.
// One place, so the pipeline and the scripts that act on its output
// (scripts/propose-summary-redactions.ts) use the same one.
const DEFAULT_MODEL = "claude-sonnet-5";

export function summaryModel(): string {
  return process.env.ANTHROPIC_SUMMARY_MODEL || DEFAULT_MODEL;
}
