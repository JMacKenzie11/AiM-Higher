// Which row of the chart spreads sideways.
//
// A chart drawn as one wide tree put every card side by side, so a
// company with a dozen sub-functions was thirteen cards wide and the
// fit shrank all of it to a third of its size (Precision
// Communications, 2026-11-23). Now only the first row that branches
// spreads across. Everything below it stacks in a column under its
// parent, the way a folder list does.
//
// The first branching row is found by walking down the single-card
// chain at the top: Visionary → Integrator → five functions puts it
// at depth 2; a chart that starts with four functions puts it at 0.
// A list at a depth greater than this one stacks.
type Branching = { children: Branching[] };

export function fanDepth(roots: Branching[]): number {
  let list = roots;
  let depth = 0;
  while (list.length === 1 && list[0].children.length > 0) {
    list = list[0].children;
    depth += 1;
  }
  return depth;
}
