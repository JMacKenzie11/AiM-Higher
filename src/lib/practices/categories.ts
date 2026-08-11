// Practice categories. Split into their own module (no server-only
// directive, no fs deps) so client components like PracticeCards can
// import the constant + type without pulling in the registry's
// server-only guarantees.
//
// Order in this array is the render order — Communication first
// because most practices land there, Facilitation second. Adding a
// new category is a string literal here plus a category assignment
// on the relevant practice(s) in registry.ts; no other code change.

export const PRACTICE_CATEGORIES = [
  "Communication",
  "Facilitation",
] as const;

export type PracticeCategory = (typeof PRACTICE_CATEGORIES)[number];
