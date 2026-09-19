"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { requireProfile } from "@/lib/auth/current-user";

export type ReorderResult = { ok: true } | { ok: false; message: string };

// The order of critical success factors inside one functional area.
//
// ---- WHO MAY DO IT, AND WHO DECIDES ---------------------------
//
// Whoever may author the measure may order it, which since 0217
// means an admin, an assigned guide, or the function's own Lead.
// That rule is NOT restated here. The writes go through the caller's
// own client and `success_measures_write_by_function` answers it,
// the same policy that governs every other edit to these rows.
//
// Stating it a second time in TypeScript would create two places to
// keep in agreement, and the app-side copy is the one that goes
// stale — failure mode E5: app guards are courtesy, RLS is the
// boundary. A caller with no seat here gets zero rows updated and
// the message below, rather than a lie about having saved.
//
// ---- WHY THE FUNCTION IS PASSED IN ----------------------------
//
// So the update can be scoped to it. A drag can only rearrange rows
// within the area it started in, and pinning the update to that
// function means a crafted call carrying another area's ids moves
// nothing: the `eq("function_id")` filters them out before RLS is
// even asked.
export async function reorderMeasuresAction(
  functionId: string,
  orderedIds: string[]
): Promise<ReorderResult> {
  await requireProfile();
  if (!functionId || orderedIds.length === 0) return { ok: true };

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  // Read first, then write only what moved. A drag usually shifts a
  // contiguous handful of rows, so this is typically two or three
  // updates rather than one per measure — and on a no-op drop, none.
  //
  // The read is also the permission probe: it is scoped to the
  // function, so ids that do not belong to it never reach a write.
  const { data: current } = await supabase
    .from("success_measures")
    .select("id, sort_order")
    .eq("function_id", functionId)
    .in("id", orderedIds);

  const currentById = new Map(
    ((current ?? []) as Array<{ id: string; sort_order: number | null }>).map(
      (row) => [row.id, row.sort_order]
    )
  );

  const changed = orderedIds
    .map((id, index) => ({ id, position: index + 1 }))
    .filter(({ id }) => currentById.has(id))
    .filter(({ id, position }) => currentById.get(id) !== position);

  if (changed.length === 0) return { ok: true };

  let moved = 0;
  for (const { id, position } of changed) {
    const { error, count } = await supabase
      .from("success_measures")
      .update({ sort_order: position }, { count: "exact" })
      .eq("id", id)
      .eq("function_id", functionId);
    if (error) {
      // Partial writes are survivable by design: sort_order is a
      // display position, ties resolve by the row's own order, and
      // the next successful drag rewrites everything that is wrong.
      // Saying so beats a silent half-order.
      return {
        ok: false,
        message: "Couldn't save the new order. Refresh and try again.",
      };
    }
    moved += count ?? 0;
  }

  // RLS refusing every row is not an error, it is an empty update.
  // Without this the caller is told the order saved and the page
  // quietly snaps back on the next render, which is the worst of
  // both: no error, no effect, no explanation.
  if (moved === 0) {
    return {
      ok: false,
      message: "You can only reorder the critical success factors you lead.",
    };
  }

  revalidatePath("/measures");
  revalidatePath("/dashboard");
  return { ok: true };
}
