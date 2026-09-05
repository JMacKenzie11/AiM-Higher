import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { InstanceConfig } from "@/lib/instances/types";

// Service-role Supabase client. NEVER import this from a Client Component
// or from any module that is transitively imported by one; "server-only"
// throws at build time if that happens.
//
// Reserved for: seed scripts, invitation email sending, and admin operations
// that must bypass RLS (e.g. creating the first profile from an accepted
// invitation, when the caller has no profile row yet).
//
// Built per call. This used to memoize one client in a module-level
// binding, which was fine while every request in the process talked to
// the same database and is exactly wrong once they don't: a module
// binding outlives the request and is shared by every concurrent one,
// so a cached client would hand one instance's service-role
// connection to the next request that landed on the process.
// Constructing a client is local work — no network — so there is
// nothing to save here.
export function createSupabaseAdminClient(
  instance: InstanceConfig,
): SupabaseClient {
  return createClient(instance.supabaseUrl, instance.supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
