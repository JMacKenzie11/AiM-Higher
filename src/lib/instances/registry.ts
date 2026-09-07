import "server-only";

import * as Sentry from "@sentry/nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { InstanceConfig, InstanceStatus } from "./types";

// The registry side of instance resolution: given a subdomain, which
// database is that, and how do we connect to it?
//
// resolve.ts stays pure and takes this as an injected function. This
// module is the impure half: it reads process.env and talks to the
// control plane.
//
// Two things are deliberate here.
//
// Keys are never in the database. A row carries env_prefix, a name
// like 'PROD', and we read {PREFIX}_SUPABASE_URL / _ANON_KEY /
// _SERVICE_KEY from the environment. A service-role key stored in a
// table ends up in every backup and every exported query result.
//
// The control plane is addressed through its own CONTROL_PLANE_*
// variables rather than the app's NEXT_PUBLIC_SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY. In production today those hold the same
// values, because the registry lives in the production project. Using
// separate names means moving the registry to its own project is an
// environment change and not a code change, so nothing in here may
// reference the app's variables.

const CONTROL_PLANE_URL_VAR = "CONTROL_PLANE_SUPABASE_URL";
const CONTROL_PLANE_KEY_VAR = "CONTROL_PLANE_SUPABASE_SERVICE_KEY";

// How long a resolved instance is reused before we ask the control
// plane again. Short enough that adding or suspending an instance
// takes effect on its own, long enough that a busy minute is one
// query rather than thousands.
const CACHE_TTL_MS = 60_000;

type CacheEntry = {
  value: InstanceConfig | null;
  expiresAt: number;
};

// MODULE-LEVEL CACHE. Safe here, and only here, because the registry
// is global configuration: which databases exist and how to reach
// them. It is identical for every request and every visitor, so one
// process sharing one copy is correct.
//
// Per-request data must NEVER be cached this way. A module-level
// binding lives for the life of the server process and is shared by
// every concurrent request it handles, so caching anything derived
// from a session — the current user, their profile, their company,
// their permissions, an auth token — leaks one person's data to the
// next request that happens to land on the same instance. Session
// state belongs in the request scope, never here.
const cache = new Map<string, CacheEntry>();

let controlPlane: SupabaseClient | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

// Lazy so importing this module doesn't demand the control plane
// variables in contexts that never look an instance up.
export function getControlPlaneClient(): SupabaseClient {
  if (controlPlane) return controlPlane;
  controlPlane = createClient(
    requireEnv(CONTROL_PLANE_URL_VAR),
    requireEnv(CONTROL_PLANE_KEY_VAR),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
  return controlPlane;
}

// The row shape of public.instances (migration 0169).
type InstanceRow = {
  subdomain: string;
  display_name: string;
  env_prefix: string;
  status: string;
};

// The column is text and constrained to two values by migration 0169.
// Anything else means the constraint was dropped underneath us or
// something wrote past it, and treating an unrecognized status as
// suspended is the safer of the two mistakes: an instance wrongly
// offline is a phone call, an instance wrongly served on the strength
// of a value we do not understand is a data question.
//
// Reported to Sentry rather than only logged. This is a silent
// condition by nature — the instance stops serving and nothing else
// changes — so without an event the first signal is a customer
// asking why their site shows a suspension notice.
//
// See the status contract in ./types.ts.
function toStatus(value: string, subdomain: string): InstanceStatus {
  if (value === "active") return "active";
  if (value === "suspended") return "suspended";

  Sentry.captureMessage(
    `[instances] "${subdomain}" has unrecognized status "${value}"; ` +
      "treating it as suspended",
    {
      level: "warning",
      tags: { instance: subdomain, instance_status: value },
    },
  );
  console.warn(
    `[instances] "${subdomain}" has unrecognized status "${value}". ` +
      "Treating it as suspended. Expected \"active\" or \"suspended\" " +
      "(migration 0169 constrains this column).",
  );
  return "suspended";
}

export async function lookupInstance(
  subdomain: string,
): Promise<InstanceConfig | null> {
  const cached = cache.get(subdomain);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await fetchInstance(subdomain);
  // Misses are cached too. An unknown subdomain is usually a scan or
  // a typo, and neither should be able to put the control plane under
  // load; a genuinely new instance costs at most one TTL of delay.
  cache.set(subdomain, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function fetchInstance(
  subdomain: string,
): Promise<InstanceConfig | null> {
  const supabase = getControlPlaneClient();
  const { data: row, error } = await supabase
    .from("instances")
    .select("subdomain, display_name, env_prefix, status")
    .eq("subdomain", subdomain)
    .maybeSingle<InstanceRow>();

  if (error) {
    console.error(
      `[instances] control plane lookup failed for "${subdomain}": ${error.message}`,
    );
    return null;
  }
  if (!row) return null;

  // Dynamic env keys are fine here: these are server-side variables,
  // not NEXT_PUBLIC_* ones, so nothing depends on the Next.js build
  // inlining them into a client bundle.
  const prefix = row.env_prefix;
  const urlVar = `${prefix}_SUPABASE_URL`;
  const anonVar = `${prefix}_SUPABASE_ANON_KEY`;
  const serviceVar = `${prefix}_SUPABASE_SERVICE_KEY`;

  const url = process.env[urlVar];
  const anonKey = process.env[anonVar];
  const serviceKey = process.env[serviceVar];

  if (!url || !anonKey || !serviceKey) {
    // A registered instance we cannot connect to is a deployment
    // mistake, and it is invisible from the outside: the request just
    // looks like an unknown host. Say which instance and which
    // variables, so the log line is the whole diagnosis.
    const missing = [
      [urlVar, url],
      [anonVar, anonKey],
      [serviceVar, serviceKey],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    console.error(
      `[instances] "${subdomain}" is registered with env_prefix "${prefix}" ` +
        `but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} ` +
        "not set. Refusing to resolve it.",
    );
    return null;
  }

  return {
    subdomain: row.subdomain,
    displayName: row.display_name,
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
    supabaseServiceKey: serviceKey,
    status: toStatus(row.status, row.subdomain),
  };
}

// Every active instance, for work that has to touch all of them
// rather than the one a request resolved to (the cron fan-out).
//
// Returns registry rows, not InstanceConfigs. Connection details
// still come from lookupInstance() per subdomain, which keeps the
// env-var resolution and its cache in one place and means a fan-out
// costs nothing extra on a warm process.
//
// This THROWS on a query error rather than returning an empty list.
// The two must not look alike to a caller: "no instances are active"
// and "the control plane did not answer" would both be zero rows,
// and a scheduled job that silently does nothing because the
// registry was unreachable is a failure nobody sees. The cron helper
// turns both into a red run, but only because this refuses to
// flatten one into the other.
export type ActiveInstanceRow = {
  subdomain: string;
  displayName: string;
  envPrefix: string;
};

export async function listActiveInstances(): Promise<ActiveInstanceRow[]> {
  // Filtered in SQL, so a suspended instance never reaches a caller
  // at all: its work does not run and it does not appear in a cron
  // summary. The status re-check in for-each.ts is defence in depth
  // for a config resolved from the cache mid-suspension, not the
  // primary gate. See the status contract in ./types.ts.
  const supabase = getControlPlaneClient();
  const { data, error } = await supabase
    .from("instances")
    .select("subdomain, display_name, env_prefix, status")
    .eq("status", "active")
    .order("subdomain");

  if (error) {
    throw new Error(
      `[instances] control plane listing of active instances failed: ${error.message}`,
    );
  }

  return ((data ?? []) as InstanceRow[]).map((row) => ({
    subdomain: row.subdomain,
    displayName: row.display_name,
    envPrefix: row.env_prefix,
  }));
}

// Drops the cache. Exported for tests, and for whatever admin action
// eventually edits the registry and wants the change to take effect
// without waiting out the TTL.
export function clearInstanceCache(): void {
  cache.clear();
}
