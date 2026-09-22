// Practice categories. Split into their own module (no server-only
// directive, no fs deps) so client components like AgentPicker can
// import the constant + type without pulling in the registry's
// server-only guarantees.
//
// Order in this array is the render order — Communication first
// because most practices land there, Facilitation second. Adding a
// new category is a string literal here plus a category assignment
// on the relevant practice(s) in registry.ts; no other code change.
//
// "People" was "Structure" until the Role Description Builder
// joined the Functional Chart Builder under it. Structure described
// the chart, which is a shape; both agents are actually about who
// does what and what they are held to. Renamed in place rather than
// added alongside, so nothing in the product still says Structure.

export const PRACTICE_CATEGORIES = [
  "Communication",
  "Facilitation",
  "People",
] as const;

export type PracticeCategory = (typeof PRACTICE_CATEGORIES)[number];
