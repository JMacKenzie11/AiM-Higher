// Single source of truth for the AiMS platform's user-facing
// vocabulary. Every label a client would read — the "Follow-Through
// Rate" number on the dashboard, the "Kept" chip on a resolved
// commitment, the "Success Measure" section title — is defined here
// so drift between screens stops happening.
//
// The `label` is what renders; the `definition` powers the
// TermTooltip glossary on first-encounter hover.
//
// Design note: labels are Title Case (proper nouns for AiMS
// concepts). Definitions are one plain-language sentence — no
// jargon, no acronyms, no AiMS-internal shorthand. Rewrite in the
// positive when possible ("Kept commitments" not "not-missed
// commitments").

export type TermKey =
  | "kept"
  | "missed"
  | "inProgress"
  | "followThroughRate"
  | "priority"
  | "strategicFocusArea"
  | "clarity"
  | "outcome"
  | "keySuccessMeasure";

export type Term = {
  label: string;
  definition: string;
};

export const TERMS: Record<TermKey, Term> = {
  kept: {
    label: "Kept",
    definition:
      "A commitment resolved on or before its due date. Kept commitments count toward the Follow-Through Rate.",
  },
  missed: {
    label: "Missed",
    definition:
      "A commitment that closed without being delivered on time. Missing a commitment is expected sometimes — the reflection captured on close is where the learning lives.",
  },
  inProgress: {
    label: "In progress",
    definition:
      "A commitment that's actively being worked on but isn't done yet. Excluded from the Follow-Through Rate the same way Open commitments are — the rate only counts commitments that have actually closed.",
  },
  followThroughRate: {
    label: "Follow-Through Rate",
    definition:
      "The share of a person's or team's resolved commitments that closed on time this quarter. A leading indicator of how reliably a team keeps the promises it makes to itself.",
  },
  priority: {
    label: "Priority",
    definition:
      "A 90-day priority is a focused result the team aims to deliver in the current quarter. Commitments and actions roll up to their priority so weekly progress is visible against the quarterly aim.",
  },
  strategicFocusArea: {
    label: "Strategic Focus Area",
    definition:
      "A multi-year strategic theme (often shortened to SFA in older screens). Annual Goals sit inside an SFA, and 90-Day Priorities sit inside a Goal.",
  },
  clarity: {
    label: "Clarity",
    definition:
      "A commitment reads as clear when it has both a real deadline (not a placeholder date) and an agreed definition of what done looks like.",
  },
  outcome: {
    label: "Critical Success Factor",
    definition:
      "A result your function must deliver to be successful, tracked with its own target and value. Most functions have two or three. Sometimes shortened to CSF.",
  },
  keySuccessMeasure: {
    label: "Key Performance Indicator",
    definition:
      "A leading measure of the activity that drives a Critical Success Factor. It moves before the result does, so it tells you early whether you're on track. Sometimes shortened to KPI.",
  },
};

// Convenience: get just the label for a term. Useful when you're
// composing longer copy strings ("kept" as part of a sentence)
// without pulling the whole record.
export function label(key: TermKey): string {
  return TERMS[key].label;
}
