import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Is this OAuth client approved? The database's answer (0280,
// assistant_client_trusted), asked with the service role because
// auth.oauth_clients is not readable otherwise. Any failure is a no:
// an unreadable registration is not an approved one.
export async function isClientApproved(clientId: string | null | undefined): Promise<boolean> {
  if (!clientId) return false;
  try {
    const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
    const { data, error } = await admin.rpc("assistant_client_trusted", { p_client_id: clientId });
    return !error && data === true;
  } catch {
    return false;
  }
}
