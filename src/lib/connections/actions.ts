"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { checkHubSpotKey, keyHint, keyShapeProblem } from "./hubspot";
import type { Connector } from "./vault";

// THE CONNECTIONS PAGE'S WRITES (external connections plan, phase 3).
//
// Who: a system admin, the company's own company admin, and anyone
// is_content_admin_for() admits (decision 3). isAdminForCompany says the
// same here; the database says it again in connection_put and
// connection_remove (0257), which run under the caller's own session and
// are the boundary. The key goes from this action to HubSpot (to check
// it) and to the vault, and nowhere else: never logged, never returned.

export type ConnectionResult = { ok: true; message: string } | { ok: false; message: string };

function refresh(companyId: string) {
  revalidatePath(`/admin/companies/${companyId}/connections`);
  revalidatePath(`/admin/companies/${companyId}`);
}

export async function saveHubSpotKeyAction(companyId: string, rawKey: string): Promise<ConnectionResult> {
  const session = await requireProfile();
  if (!isAdminForCompany(session.profile, companyId)) {
    return { ok: false, message: "Only this company's admins can manage its connections." };
  }
  // HubSpot feeds Critical Success Factors only, so the card, and this,
  // are behind the same feature.
  if (!(await companyHasFeature(companyId, "external_measures"))) {
    return { ok: false, message: "This company doesn't have measures from outside systems switched on." };
  }

  const key = rawKey.trim();
  const shape = keyShapeProblem(key);
  if (shape) return { ok: false, message: shape };

  const check = await checkHubSpotKey(key);
  if (!check.ok) return check;

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { error } = await supabase.rpc("connection_put", {
    p_company_id: companyId,
    p_connector: "hubspot",
    p_secret: key,
    p_hint: keyHint(key),
    p_account_label: check.accountLabel,
    p_scopes: check.scopes,
  });
  if (error) {
    return {
      ok: false,
      message: error.code === "42501" ? "Only this company's admins can manage its connections." : "Couldn't save the key. Try again.",
    };
  }
  refresh(companyId);
  return { ok: true, message: "Saved. HubSpot accepted the key, and it can read deals." };
}

export async function removeConnectionAction(companyId: string, connector: Connector): Promise<ConnectionResult> {
  const session = await requireProfile();
  if (!isAdminForCompany(session.profile, companyId)) {
    return { ok: false, message: "Only this company's admins can manage its connections." };
  }
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase.rpc("connection_remove", {
    p_company_id: companyId,
    p_connector: connector,
  });
  if (error) {
    return {
      ok: false,
      message: error.code === "42501" ? "Only this company's admins can manage its connections." : "Couldn't disconnect. Try again.",
    };
  }
  refresh(companyId);
  return data === true
    ? { ok: true, message: "Disconnected. The key is deleted." }
    : { ok: true, message: "It was already disconnected." };
}
