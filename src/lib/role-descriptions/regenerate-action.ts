"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteRoleDescriptionCache } from "./cache";

// Admin-only escape hatch for the RD cache. Deletes the stored
// document for a function and revalidates the view page, forcing
// the next visit to re-run generation from scratch. Used when
// foundation copy (values, purpose) changes and the caller wants
// the RD to reflect it without waiting for a chart-entity edit
// to trigger auto-invalidation.

export async function regenerateRoleDescriptionAction(
  functionId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireProfile();

  const supabase = await createSupabaseServerClient();
  const { data: fn } = await supabase
    .from("functions")
    .select("company_id")
    .eq("id", functionId)
    .maybeSingle<{ company_id: string }>();
  if (!fn) return { ok: false, message: "Function not found." };

  if (!isAdminForCompany(session.profile, fn.company_id)) {
    return {
      ok: false,
      message: "You don't have permission to regenerate this role description.",
    };
  }

  await deleteRoleDescriptionCache(functionId);
  revalidatePath(`/chart/function/${functionId}/role-description`);
  return { ok: true };
}
