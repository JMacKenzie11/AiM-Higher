// The arithmetic behind dragging focus areas into a new order, kept
// apart from the server action so it can be tested without a
// database.
//
// `orderedIds` is the order the admin dropped them in. The answer is
// the rows whose stored number has to change for that order to hold,
// each numbered by its place in the list. Rows already holding the
// right number are left out, so a drag that swaps two neighbours in
// a settled list writes two rows, not all of them.

export type SfaPosition = { id: string; company_id: string; sort_order: number };

export function planSfaReorder(
  current: Pick<SfaPosition, "id" | "sort_order">[],
  orderedIds: string[]
): { id: string; sort_order: number }[] {
  const stored = new Map(current.map((row) => [row.id, row.sort_order]));
  return orderedIds.flatMap((id, index) =>
    stored.has(id) && stored.get(id) !== index
      ? [{ id, sort_order: index }]
      : []
  );
}
