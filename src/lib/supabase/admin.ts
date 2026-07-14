import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "./env";

// Service-role Supabase client. NEVER import this from a Client Component
// or from any module that is transitively imported by one; "server-only"
// throws at build time if that happens.
//
// Reserved for: seed scripts, invitation email sending, and admin operations
// that must bypass RLS (e.g. creating the first profile from an accepted
// invitation, when the caller has no profile row yet).

let cached: SupabaseClient | null = null;

export function createSupabaseAdminClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(SUPABASE_URL(), SUPABASE_SERVICE_ROLE_KEY(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cached;
}
