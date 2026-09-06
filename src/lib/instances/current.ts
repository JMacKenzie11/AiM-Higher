import { headers } from "next/headers";

import type { InstanceConfig } from "./types";
import { INSTANCE_HEADER, parseInstanceHeader } from "./request";

// The current request's instance, for every server-side caller.
//
// Middleware resolves the hostname once (src/middleware.ts) and
// attaches the result as a request header. This reads it back. One
// resolution per request, at the top, and everything downstream just
// asks for the answer.
//
// The signature is a promise now, not because the resolution is
// expensive but because next/headers is async in Next 15. Call sites
// written as createSupabaseServerClient(getCurrentInstanceConfig())
// are unchanged: the client factories accept the promise and await it
// themselves.

export async function getCurrentInstanceConfig(): Promise<InstanceConfig> {
  // headers() throws outside a request scope. That is the signal for
  // "nothing resolved this", not an error worth propagating.
  let attached: InstanceConfig | null = null;
  try {
    const store = await headers();
    attached = parseInstanceHeader(store.get(INSTANCE_HEADER));
  } catch {
    attached = null;
  }
  if (attached) return attached;
  return fallbackInstanceConfig();
}

// ---- The fallback ---------------------------------------------
//
// For code that never passes through middleware. In practice that is
// the cron routes, which src/lib/instances/middleware-decision.ts
// excludes from resolution outright: a scheduled invocation has no
// meaningful hostname and no user whose instance it belongs to, so
// the job says which database it is for rather than inferring one.
//
// It says so by environment variable, and if the environment does not
// say, this throws. That is the whole point of it. The alternative,
// and what this used to do, was to fall back to the app's legacy
// NEXT_PUBLIC_SUPABASE_* variables, which meant a misconfigured
// scheduled job did not fail: it ran, successfully, against whichever
// database those happened to name. A cron writing a week of scorecard
// rows into the wrong customer's database is not an error anyone sees
// until much later. Stopping is the cheaper mistake.
//
// TODO (Phase 4): cron fans out. Right now a scheduled job runs once
// against one database, which is why naming a single prefix here is
// enough. Once there are several live instances, each job needs to
// enumerate the registry and run per instance, and this becomes wrong
// rather than merely narrow.

const PROD_PREFIX = "PROD";

type EnvSource = {
  // What to call this set of variables when reporting it missing.
  label: string;
  subdomain: string;
  displayName: string;
  url: string | undefined;
  anonKey: string | undefined;
  serviceKey: string | undefined;
};

function fallbackInstanceConfig(): InstanceConfig {
  const sources: EnvSource[] = [
    // The deployed answer. One live instance today, named by prefix.
    {
      label: `${PROD_PREFIX}_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY`,
      subdomain: PROD_PREFIX.toLowerCase(),
      displayName: "Production",
      url: process.env[`${PROD_PREFIX}_SUPABASE_URL`],
      anonKey: process.env[`${PROD_PREFIX}_SUPABASE_ANON_KEY`],
      serviceKey: process.env[`${PROD_PREFIX}_SUPABASE_SERVICE_KEY`],
    },
    // The developer's answer. Same three variables the resolver
    // honours in src/lib/instances/resolve.ts, so a developer who has
    // already pinned their machine to a database can exercise a cron
    // route locally without setting PROD_* and pointing it at the
    // live one by accident.
    {
      label:
        "LOCAL_INSTANCE_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY",
      subdomain: "local",
      displayName: "Local",
      url: process.env.LOCAL_INSTANCE_SUPABASE_URL,
      anonKey: process.env.LOCAL_INSTANCE_SUPABASE_ANON_KEY,
      serviceKey: process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY,
    },
  ];

  for (const source of sources) {
    if (source.url && source.anonKey && source.serviceKey) {
      return {
        subdomain: source.subdomain,
        displayName: source.displayName,
        supabaseUrl: source.url,
        supabaseAnonKey: source.anonKey,
        supabaseServiceKey: source.serviceKey,
        status: "active",
      };
    }
  }

  throw new Error(
    "No instance for this request. Middleware resolved none (which is " +
      "expected for a cron route), and neither set of fallback variables " +
      `is complete: ${sources.map((s) => s.label).join(" or ")}. ` +
      "Set one of them. See .env.example. Refusing to guess a database.",
  );
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
