// Which rows a company reorder writes. A plain module, not the
// "use server" actions file beside it: Next allows only async
// functions to be exported from one of those, and this is a pure
// function the tests call directly.

export type CompanyPosition = { id: string; sort_order: number | null; name: string };

// WRITE ONLY THE COMPANIES WHOSE PLACE CHANGED (2026-09-29).
//
// This used to number the whole list 1, 2, 3... and save every row
// whose number differed. After a company is removed its number leaves
// a gap, so the next drag re-saved every company below the gap even
// though none of them moved. The browser tests swap two fixture
// companies, and that re-saved the rows of real ones; tests must never
// change anything belonging to a real company (docs/e2e.md).
//
// So: the old order is the current positions (then name, as the list
// sorts). A company keeps its row untouched if its place in the list is
// the same. The companies that did change places share out the
// position numbers they already held, in the new order. Those numbers
// sit at exactly the places those companies occupy, so the whole list
// still sorts into the new order. A swap is two writes.
//
// If any company has no position yet, or two share one, there are no
// numbers to share out safely, and it falls back to numbering the list
// 1..N, as before.
export function planCompanyReorder(
  current: readonly CompanyPosition[],
  orderedIds: readonly string[]
): Array<{ id: string; position: number }> {
  const byId = new Map(current.map((row) => [row.id, row]));
  const rows = orderedIds.map((id) => byId.get(id)).filter((r): r is CompanyPosition => !!r);
  const values = rows.map((r) => r.sort_order);
  const usable =
    rows.length === orderedIds.length &&
    values.every((v): v is number => v !== null) &&
    new Set(values).size === values.length;

  if (!usable) {
    return orderedIds
      .map((id, index) => ({ id, position: index + 1 }))
      .filter(({ id, position }) => byId.get(id)?.sort_order !== position);
  }

  const oldOrder = [...rows]
    .sort((a, b) => (a.sort_order as number) - (b.sort_order as number) || a.name.localeCompare(b.name))
    .map((r) => r.id);
  const moved = orderedIds.filter((id, index) => oldOrder[index] !== id);
  const pool = moved.map((id) => byId.get(id)!.sort_order as number).sort((a, b) => a - b);
  return moved
    .map((id, k) => ({ id, position: pool[k] }))
    .filter(({ id, position }) => byId.get(id)!.sort_order !== position);
}
