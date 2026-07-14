"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

// Browser (client-component) Supabase instance. Reads the session
// cookie set by middleware. Uses the anon key only — never the
// service role.
export function createSupabaseBrowserClient() {
  return createBrowserClient(SUPABASE_URL(), SUPABASE_ANON_KEY());
}
