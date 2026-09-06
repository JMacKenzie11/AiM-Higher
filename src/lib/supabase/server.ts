import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { InstanceConfig } from "@/lib/instances/types";

// Server-component / server-action / route-handler Supabase client.
// Uses the request's cookies so RLS runs as the signed-in user.
//
// Takes the instance to connect to rather than reading env vars, so
// which database a request talks to is a decision made once, in
// middleware, and passed down. Callers pass getCurrentInstanceConfig().
//
// Accepts the promise that returns, not just the value, so those call
// sites read as createSupabaseServerClient(getCurrentInstanceConfig())
// with no await of their own.
export async function createSupabaseServerClient(
  instance: InstanceConfig | Promise<InstanceConfig>,
) {
  const [cookieStore, config] = await Promise.all([cookies(), instance]);

  return createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components can't mutate cookies. Middleware handles
          // rotation instead; ignoring here matches the @supabase/ssr recipe.
        }
      },
    },
  });
}
