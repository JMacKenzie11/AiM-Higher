// Every function beneath one, however deep.
//
// Its own module, and not a helper inside actions.ts, for two
// reasons. A "use server" file may only export async functions, so a
// synchronous helper exported from there fails the build. And this
// is the guard that keeps the chart a tree, which is worth being
// able to test without a database.

export type ParentLink = { id: string; parent_function_id: string | null };

// Iterative rather than recursive, and `seen` guarded, because the
// data it walks is exactly the data it exists to keep clean: a cycle
// already in the table would otherwise hang the request that was
// trying to stop the next one.
export function descendantsOf(
  rootId: string,
  rows: readonly ParentLink[]
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parent_function_id) continue;
    const list = childrenOf.get(r.parent_function_id) ?? [];
    list.push(r.id);
    childrenOf.set(r.parent_function_id, list);
  }
  const out = new Set<string>();
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

// The functions a given function may be moved under: everything on
// the chart except itself and its own descendants. Titles carry an
// indent so a flat <select> still reads as a tree, the way the add
// panel's picker does.
export function parentChoicesFor(
  functionId: string,
  rows: readonly (ParentLink & { title: string; sort_order: number })[]
): Array<{ id: string; title: string }> {
  const blocked = descendantsOf(functionId, rows);
  blocked.add(functionId);

  const childrenOf = new Map<string | null, typeof rows[number][]>();
  for (const r of rows) {
    const list = childrenOf.get(r.parent_function_id) ?? [];
    list.push(r);
    childrenOf.set(r.parent_function_id, list);
  }
  const sorted = (list: typeof rows[number][]) =>
    [...list].sort((a, b) =>
      a.sort_order !== b.sort_order
        ? a.sort_order - b.sort_order
        : a.title.localeCompare(b.title)
    );

  const out: Array<{ id: string; title: string }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const row of sorted(childrenOf.get(parentId) ?? [])) {
      // A blocked function is skipped, and so is everything under
      // it: its subtree is blocked by definition, and walking into
      // it would offer a descendant as a parent.
      if (blocked.has(row.id)) continue;
      out.push({
        id: row.id,
        title: depth === 0 ? row.title : `${"— ".repeat(depth)}${row.title}`,
      });
      walk(row.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
