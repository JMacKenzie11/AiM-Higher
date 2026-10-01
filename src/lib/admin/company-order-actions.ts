"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { requireProfile } from "@/lib/auth/current-user";
import { planCompanyReorder, type CompanyPosition } from "./company-order";

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
