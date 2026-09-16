// The /plan cascade can be linked to BY ROW. A detail page's back
// link carries the fragment of the row the reader came from, and the
// cascade renders the matching id on that row.
//
// Both sides call these, so the fragment and the id cannot drift
// apart. That drift is the only way this breaks, and it breaks
// SILENTLY: an unmatched fragment scrolls nowhere and looks like an
// ordinary link to the top of the page.

export function sfaAnchorId(sfaId: string): string {
  return `sfa-${sfaId}`;
}

export function goalAnchorId(goalId: string): string {
  return `goal-${goalId}`;
}

export function planHrefForSfa(sfaId: string): string {
  return `/plan#${sfaAnchorId(sfaId)}`;
}

export function planHrefForGoal(goalId: string): string {
  return `/plan#${goalAnchorId(goalId)}`;
}
