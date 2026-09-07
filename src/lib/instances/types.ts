// The connection details for one customer instance.
//
// An instance is a subdomain plus the database behind it. Every
// instance has its own Supabase project, so resolving a request to an
// instance is the same thing as choosing which database to talk to.
// There is deliberately no "default" instance: a request that does not
// resolve gets nothing, rather than quietly landing in someone else's
// data.

// ---- What a registry status MEANS operationally ----------------
//
// `public.instances.status` is not a label. It is the switch that
// takes an instance on and offline, and flipping that one column is
// the whole procedure: no DNS change, no Vercel change, no env var
// touched, nothing deleted. Use it for non-payment, for trouble
// during a migration, and for a teardown in progress.
//
// "active"
//   Middleware serves the app on that hostname.
//   The cron fan-out includes it (src/lib/instances/for-each.ts).
//   The migration runner migrates it (scripts/migrate-instances.ts).
//
// "suspended"
//   Middleware serves /instance-suspended instead of the app, on
//     every path. No session refresh, no database touched.
//   The cron fan-out omits it. Its work simply does not run: a
//     suspended instance should not be ingesting transcripts or
//     creating commitments for people who cannot sign in.
//   The migration runner skips it, and says so, so an operator
//     reading the pre-deploy summary knows the instance exists and
//     was deliberately passed over rather than missed.
//   Nothing is deleted and no key is rotated. Flipping back to
//     "active" restores service with no other step.
//
// anything else
//   Treated exactly as "suspended", and reported to Sentry as a
//   warning naming the instance and the value. An unrecognized
//   status means the CHECK constraint from migration 0169 was
//   dropped or something wrote past it, and of the two possible
//   mistakes, refusing to serve an instance is the recoverable one.
//   Serving a customer's data on the strength of a value we do not
//   understand is not.
//
// A status change takes effect within one registry cache TTL
// (CACHE_TTL_MS in registry.ts, 60s), because that is how long a
// resolution is reused. Suspending is not instant and is not meant
// to be; if an instance has to be cut off this second, that is an
// infrastructure action, not a registry one.
//
// Documented for operators in docs/deployment.md.
export type InstanceStatus = "active" | "suspended";

// Whether this instance should be served and worked on at all. Every
// consumer of a status asks through this rather than comparing to a
// string, so "what counts as active" has exactly one definition.
export function isServable(status: InstanceStatus): boolean {
  return status === "active";
}

export type InstanceConfig = {
  // The first label of the hostname, e.g. "acme" in acme.example.com.
  subdomain: string;
  // Human-readable name for the instance, shown in admin surfaces.
  displayName: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  // Service-role key. Server-side only, never sent to a browser.
  supabaseServiceKey: string;
  // Suspended instances still resolve. What suspension means (a
  // billing screen, a read-only mode, a hard block) is the caller's
  // decision, not this library's.
  status: InstanceStatus;
};
