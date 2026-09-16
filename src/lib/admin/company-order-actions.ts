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

  // Read first, then write only what moved. A drag usually shifts a
  // contiguous handful of rows, so this is typically two or three
  // updates rather than one per company — and on a no-op drop, none
  // at all.
  const { data: current } = await supabase
    .from("companies")
    .select("id, sort_order")
    .in("id", orderedIds);
  const currentById = new Map(
    ((current ?? []) as Array<{ id: string; sort_order: number | null }>).map(
      (row) => [row.id, row.sort_order]
    )
  );

  const changed = orderedIds
    .map((id, index) => ({ id, position: index + 1 }))
    .filter(({ id, position }) => currentById.get(id) !== position);

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
