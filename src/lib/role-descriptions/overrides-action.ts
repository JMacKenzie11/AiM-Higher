"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { patchUserOverrides } from "./cache";
import type { RdUserOverrides } from "./generate";

// Save (or clear) any subset of a Role Description's user overrides
// for a function. Admin-only per the guides-as-company-admins rule.
// Called from every EditableProseSection / EditableOutcomeEnrichment
// / EditableResponsibilityContext / EditableStrengths /
// EditableQualifications component.
//
// Empty/whitespace strings in the patch clear that field from the
// overrides jsonb. Empty enrichment entries drop that matchTitle
// entry entirely — see mergeOverrides in cache.ts.

export async function saveRoleDescriptionOverrideAction(input: {
  functionId: string;
  patch: RdUserOverrides;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireProfile();

  const supabase = await createSupabaseServerClient();
  const { data: fn } = await supabase
    .from("functions")
    .select("company_id")
    .eq("id", input.functionId)
    .maybeSingle<{ company_id: string }>();
  if (!fn) return { ok: false, message: "Function not found." };

  if (!isAdminForCompany(session.profile, fn.company_id)) {
    return {
      ok: false,
      message: "You don't have permission to edit this role description.",
    };
  }

  const result = await patchUserOverrides({
    functionId: input.functionId,
    patch: input.patch,
  });
  if (!result.ok) return result;

  revalidatePath(`/chart/function/${input.functionId}/role-description`);
  return { ok: true };
}
