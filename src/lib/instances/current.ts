import type { InstanceConfig } from "./types";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
} from "@/lib/supabase/env";

// TRANSITIONAL. This function exists to be deleted.
//
// Every Supabase client in the app is now built from an
// InstanceConfig rather than from env vars directly. That is the
// shape multi-instance needs. What it does NOT yet have is a real
// answer to "which instance is this request for?" — so for now every
// request gets the same answer, assembled from the same
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY the app has always used.
//
// The result is behaviour-neutral by construction: same URL, same
// keys, same database, one indirection later.
//
// The next change replaces this with real resolution. Middleware will
// resolve the hostname through src/lib/instances/resolve.ts and the
// registry, and hand the resulting config down the request. When that
// lands, every getCurrentInstanceConfig() call site becomes a read of
// the resolved instance and this file goes away.
//
// Deliberately not cached and deliberately not a module-level
// constant. Building it is three env reads; making it a singleton now
// would bake in a per-process assumption that is exactly wrong once
// the config varies per request.

export function getCurrentInstanceConfig(): InstanceConfig {
  return {
    // No hostname has been resolved, so there is no real subdomain to
    // report. Named for what it is rather than guessed at.
    subdomain: "default",
    displayName: "Default",
    supabaseUrl: SUPABASE_URL(),
    supabaseAnonKey: SUPABASE_ANON_KEY(),
    supabaseServiceKey: SUPABASE_SERVICE_ROLE_KEY(),
    status: "active",
  };
}

// The subset a browser needs. The anon key is safe to expose (it is
// already in the client bundle today via NEXT_PUBLIC_*), the service
// key is not, so client code takes this type and never InstanceConfig.
export type PublicInstanceConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export function toPublicInstanceConfig(
  config: InstanceConfig,
): PublicInstanceConfig {
  return {
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
  };
}
