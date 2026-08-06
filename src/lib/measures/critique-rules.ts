import type { MetricValueType } from "@/lib/types";

// Shared shape both the rule-based (client) and AI-scored (server)
// layers return. Fields are null when that dimension passes; a
// short coaching note otherwise. Kept here (not in ./critique.ts)
// so client components can import the type without pulling in the
// SDK-heavy server module.
export type MeasureCritique = {
  descriptionHint: string | null;
  fitHint: string | null;
  targetHint: string | null;
};

// Rule-based, client-safe layer of the metric-draft critique. Pure
// function, no side effects, no server-only imports — the
// AddMetricRow component calls this on every keystroke to render
// instant coaching hints without a round trip. The AI critique in
// ./critique.ts extends this with fit-to-outcome + description-
// quality signals that a keyword list can't reach.
//
// Flag-not-block: every hint is advisory. The row can still be
// saved with hints showing.

const WEAK_PHRASES = [
  "do your best",
  "as much as possible",
  "as needed",
  "as soon as possible",
  "asap",
  "when possible",
  "when able",
  "tbd",
  "improve",
  "improvement",
  "better",
  "good",
  "great",
  "high quality",
  "quality",
  "excellence",
  "some",
  "many",
  "several",
  "lots",
  "more",
  "less",
  "reasonable",
];

const NUMERIC_HINT_RE = /[0-9%]/;

export function ruleBasedCritique(input: {
  description: string;
  target: string;
  valueType: MetricValueType;
}): { descriptionHint: string | null; targetHint: string | null } {
  const d = input.description.trim().toLowerCase();
  const t = input.target.trim();

  // Only flag on things we're actually confident about — weak-phrase
  // hits like "do your best" and "improve". Word count and generic
  // "does this look countable?" heuristics catch too many good short
  // metrics ("Utilization %", "Revenue", "Attrition rate"). The AI
  // layer handles the fuzzier "is this too vague?" call.
  let descriptionHint: string | null = null;
  if (d.length > 0) {
    const hit = WEAK_PHRASES.find((phrase) => d.includes(phrase));
    if (hit) {
      descriptionHint = `"${hit}" isn't countable — try a phrase like "% of projects on time" or "average lead time (days)".`;
    }
  }

  let targetHint: string | null = null;
  if (d.length > 0 && t.length === 0) {
    targetHint = "Set a target so you know when the number is good enough.";
  } else if (
    (input.valueType === "number" || input.valueType === "percent") &&
    t.length > 0 &&
    !NUMERIC_HINT_RE.test(t)
  ) {
    targetHint = "For a number/percent metric the target should include a digit.";
  }

  return { descriptionHint, targetHint };
}
