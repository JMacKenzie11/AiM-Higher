// THE FUNCTIONAL AREAS THAT GIVE A HEADLINE, without the leadership
// seats (Jason, 2026-10-20: "we don't need the visionary or the
// integrator (or they might call it CEO or COO) to provide updates,
// just the functional areas").
//
// Nothing on a function says it is a leadership seat, and the seats
// are renamed (the chart proposal renames the seeded Visionary and
// Integrator, 0112). So they are found by where they sit, which is how
// every company's chart starts (0114): the one top box, when it has
// boxes under it, and its one box under it when that box has boxes
// under it in turn (the Visionary, then the Integrator the areas report
// to). A box in those top two levels called Visionary, Integrator,
// CEO, COO or by their long names counts too, for a chart shaped
// differently. A chart with several top boxes has no seats by place:
// those boxes are the areas, and give their headlines.

export type ChartFunction = { id: string; title: string; parent_function_id: string | null };

const SEAT_TITLES = new Set([
  "visionary",
  "integrator",
  "ceo",
  "coo",
  "chief executive officer",
  "chief operating officer",
]);

export function leadershipSeatIds(fns: readonly ChartFunction[]): Set<string> {
  const ids = new Set(fns.map((f) => f.id));
  const children = new Map<string, ChartFunction[]>();
  for (const f of fns) {
    if (f.parent_function_id && ids.has(f.parent_function_id)) {
      children.set(f.parent_function_id, [...(children.get(f.parent_function_id) ?? []), f]);
    }
  }
  const isRoot = (f: ChartFunction) => !f.parent_function_id || !ids.has(f.parent_function_id);
  const seats = new Set<string>();
  const roots = fns.filter(isRoot);
  for (const root of roots) {
    const under = children.get(root.id) ?? [];
    // By place, only under a single top box: with several, the top
    // boxes are the areas themselves.
    if (roots.length === 1 && under.length > 0) {
      seats.add(root.id);
      if (under.length === 1 && (children.get(under[0].id) ?? []).length > 0) seats.add(under[0].id);
    }
    // By name, in the top two levels.
    for (const f of [root, ...under]) {
      if (SEAT_TITLES.has(f.title.trim().toLowerCase())) seats.add(f.id);
    }
  }
  return seats;
}

export function headlineAreas<F extends ChartFunction>(fns: readonly F[]): F[] {
  const seats = leadershipSeatIds(fns);
  return fns.filter((f) => !seats.has(f.id));
}
