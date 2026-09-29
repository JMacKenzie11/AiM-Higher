"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { requireProfile } from "@/lib/auth/current-user";

export type ReorderResult = { ok: true } | { ok: false; message: string };

// Put the portfolio's companies in the order its owner wants them.
// Migration 0203.
//
// ORDERING THE PORTFOLIO IS A CONTAINER ACTION, so it belongs to the
// two roles whose scope is the container. A company admin reordering
// the instance would be a company deciding where it sits among its
// siblings. The database says the same thing and says it first: the
// column guard on `companies` admits `sort_order` for
// portfolio_admin only, and refuses it to a company_admin and a guide
// through a denylist written before the column existed.
//
// THE WRITES GO THROUGH THE CALLER'S OWN CLIENT, deliberately. There
// is no admin client here and no definer function, because the
// boundary already exists and is correct: companies_update plus the
// guard. Adding a second expression of the same rule would mean two
// places to keep in agreement.
export async function reorderCompaniesAction(
  orderedIds: string[]
): Promise<ReorderResult> {
  const session = await requireProfile();
  const role = session.profile.role;
  if (role !== "system_admin" && role !== "portfolio_admin") {
    return { ok: false, message: "Only the portfolio's owner can reorder companies." };
  }
  if (orderedIds.length === 0) return { ok: true };

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  // Only the companies whose place in the list changed are written
  // (planCompanyReorder). Everyone else's row is left alone, even when
  // positions have gaps from removed companies.
  const { data: current } = await supabase
    .from("companies")
    .select("id, sort_order, name")
    .in("id", orderedIds);
  const changed = planCompanyReorder(
    (current ?? []) as CompanyPosition[],
    orderedIds
  );

  for (const { id, position } of changed) {
    const { error } = await supabase
      .from("companies")
      .update({ sort_order: position })
      .eq("id", id);
    if (error) {
      // Partial writes are possible here and are survivable by
      // design: sort_order is a display position, ties resolve by
      // name, and the next successful reorder rewrites everything
      // that is wrong. Saying so is better than a silent half-order.
      return {
        ok: false,
        message: "Couldn't save the new order. Refresh and try again.",
      };
    }
  }

  revalidatePath("/admin/companies");
  revalidatePath("/portfolio");
  return { ok: true };
}

// ---- Which rows a reorder writes -------------------------------------

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
