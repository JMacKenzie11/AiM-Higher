// The baseline responsibility every function carries.
//
// It is written by a DATABASE TRIGGER, not by any code path here:
// migration 0107 inserts one `is_default` row holding
// "Lead, Track, Decide" at sort_order 0 for every function as it is
// created, and RLS blocks update and delete on it. Top seats are
// functions too, so the Visionary and the Integrator get it on the
// same terms as Sales does.
//
// That makes LTD a FACT about any function, not a decision anybody
// gets to make — which is the whole reason this module exists. The
// chart-builder practice used to ask the model to emit it as the
// first responsibility, in the older "Leadership, Management, and
// Accountability (LMA)" wording. Applying such a proposal wrote the
// model's line at sort_order 1, directly under the trigger's row:
// the same idea twice, under two different names, on every function.
//
// So the model no longer emits it, and anything baseline-shaped that
// arrives anyway is stripped on the way in. The card renders LTD
// itself, from this constant, which is also what makes it appear on
// the two top seats — the model never had a field to put it in.

export const BASELINE_ROLE = "Lead, Track, Decide";

// Every spelling worth catching, normalized. The list is
// deliberately generous: a false positive drops a line the database
// is about to write anyway, and a false negative puts a duplicate in
// front of a client.
const BASELINE_PREFIXES = [
  "lead track decide",
  "lead track and decide",
  "leadership management accountability",
  "leadership management and accountability",
  "ltd",
  "lma",
];

// Punctuation out, whitespace collapsed, lowercased. "Lead, Track,
// and Decide" and "LEAD / TRACK / DECIDE" both land on the same
// string.
function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// PREFIX, not equality, because the model qualifies it: the observed
// output is "Leadership, Management, and Accountability (LMA) for the
// sales and marketing function". Requiring the whole string to match
// would have caught none of the lines this exists to catch.
export function isBaselineRole(title: string): boolean {
  const n = normalize(title);
  if (n.length === 0) return false;
  return BASELINE_PREFIXES.some(
    (p) => n === p || n.startsWith(`${p} `)
  );
}

// Drop every baseline-shaped entry from a proposed list. Order of
// the rest is preserved: it is the order the model chose and the
// order they will be written in.
export function withoutBaselineRole(
  responsibilities: readonly string[]
): string[] {
  return responsibilities.filter((r) => !isBaselineRole(r));
}
