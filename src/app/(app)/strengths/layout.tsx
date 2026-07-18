// Route-group layout for the Strengths module. Its only job is to
// import strengths-legacy.css — a compatibility sheet that provides
// the generic class names (stack-*, card, chip-*, btn btn-*, form-grid,
// bar-track, hero-shell, container-wide, …) that the two large client
// components (TeamPage.tsx, RecommendPage.tsx) still use.
//
// Scoping the sheet to this layout keeps those legacy class names out
// of the global namespace on non-strengths routes. Ported strengths
// pages (welcome/results/assessment/teams) use CSS Modules and don't
// depend on this file; it's a bridge until TeamPage and RecommendPage
// get their own module-css rewrites.

import "./strengths-legacy.css";

export default function StrengthsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
