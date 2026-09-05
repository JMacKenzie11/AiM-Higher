"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { PublicInstanceConfig } from "@/lib/instances/current";

// Browser (client-component) Supabase instance. Reads the session
// cookie set by middleware. Uses the anon key only — never the
// service role, which is why this takes PublicInstanceConfig and not
// the full InstanceConfig.
//
// The config comes from InstanceProvider, mounted by the
// authenticated layout: useInstanceConfig() in the calling component,
// passed in here.
export function createSupabaseBrowserClient(instance: PublicInstanceConfig) {
  return createBrowserClient(instance.supabaseUrl, instance.supabaseAnonKey);
}
