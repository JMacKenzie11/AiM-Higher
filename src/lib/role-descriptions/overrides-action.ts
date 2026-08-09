"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setUserOverride } from "./cache";
import type { RdUserOverrides } from "./generate";

// Save (or clear) a single Role Description prose override for a
// function. Admin-only per the guides-as-company-admins rule.
// Called from EditableProseSection when the user hits Save or
// Restore generated.

export type OverrideField = keyof RdUserOverrides;

export async function saveRoleDescriptionOverrideAction(input: {
  functionId: string;
  field: OverrideField;
  value: string | null;
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

  const result = await setUserOverride({
    functionId: input.functionId,
    field: input.field,
    value: input.value,
  });
  if (!result.ok) return result;

  revalidatePath(`/chart/function/${input.functionId}/role-description`);
  return { ok: true };
}
