import { isServable, type InstanceConfig } from "./types";

// What middleware does with a resolution result.
//
// Kept as a pure function so the routing rule can be unit-tested
// without a NextRequest, the same way scope-request.ts holds the
// auto-scope rule.

// Public, unauthenticated, and deliberately outside every route
// group: it renders on hostnames that resolve to no database at all,
// so it cannot depend on a layout that reads one.
export const INSTANCE_NOT_FOUND_PATH = "/instance-not-found";

// Same constraints as the not-found page, and reached for the
// opposite reason: this hostname IS a registered instance, we simply
// are not serving it. Suspension is a registry column, so taking an
// instance offline is one row update and no infrastructure change.
// See the status contract in ./types.ts.
export const INSTANCE_SUSPENDED_PATH = "/instance-suspended";

// The HTTP status each boundary answers with.
//
// These pages used to answer 200, which is a lie told to machines. A
// 200 tells an uptime monitor the hostname is healthy, tells a
// crawler there is a real page worth indexing at that address, and
// tells any automated client to carry on. The friendly body was for
// humans; the status is the part software reads, and it disagreed
// with it.
//
// 404 for an unknown hostname: there is nothing here and there never
// was. A crawler should forget it.
//
// 503 for a suspended instance: there IS something here and it is
// temporarily not being served. 503 is the one status that says
// "come back later" rather than "give up" — a crawler retries rather
// than deindexing a customer's site over a billing pause, and an
// uptime monitor reports an outage rather than silent success.
export const INSTANCE_NOT_FOUND_STATUS = 404;
export const INSTANCE_SUSPENDED_STATUS = 503;

export type InstanceRouting =
  // Resolved AND servable. Carry this config through the request.
  | { action: "proceed"; instance: InstanceConfig }
  // Unresolved, or resolved but not being served. Show the matching
  // boundary page, with the status that describes what happened.
  //
  // The status travels with the routing decision rather than being
  // applied in middleware, so the two can never drift: whatever
  // decides WHICH page also decides what it answers.
  | { action: "rewrite"; to: string; status: number }
  // Already on one of those boundary pages. Render it without
  // resolving, or the hostname would rewrite to it forever.
  | { action: "passthrough" };

const BOUNDARY_PATHS: readonly string[] = [
  INSTANCE_NOT_FOUND_PATH,
  INSTANCE_SUSPENDED_PATH,
];

export function routeForInstance({
  pathname,
  instance,
}: {
  pathname: string;
  instance: InstanceConfig | null;
}): InstanceRouting {
  if (BOUNDARY_PATHS.includes(pathname)) return { action: "passthrough" };
  if (!instance) {
    return {
      action: "rewrite",
      to: INSTANCE_NOT_FOUND_PATH,
      status: INSTANCE_NOT_FOUND_STATUS,
    };
  }
  // Resolved, but the registry says do not serve it. Rewriting here
  // means no session is refreshed and the instance's database is
  // never opened on this request: the suspension is enforced before
  // anything downstream can assume an instance it can use.
  //
  // Every path, including /sign-in. A suspension that still let
  // people authenticate would be a broken app rather than a paused
  // one, and the person hitting it deserves the notice, not a login
  // form that fails afterwards.
  if (!isServable(instance.status)) {
    return {
      action: "rewrite",
      to: INSTANCE_SUSPENDED_PATH,
      status: INSTANCE_SUSPENDED_STATUS,
    };
  }
  return { action: "proceed", instance };
}

// ---- Paths that never resolve an instance ---------------------
//
// Scheduled jobs. Vercel invokes these on a schedule, not on behalf
// of a visitor, so the hostname it happens to use says nothing about
// which database the job is for. Running them through resolution
// would be worse than useless: today the production hostname is one
// registry row, so every cron would either be rewritten to
// /instance-not-found and silently return a 200 having done nothing,
// or quietly run against whichever instance the scheduler's URL
// pointed at.
//
// So they are excluded here and pick their own instance explicitly
// through getCurrentInstanceConfig()'s fallback, which throws by name
// when it has not been told which database to use. A cron that cannot
// tell must stop, not guess.
//
// Nothing else belongs in this list. These routes carry their own
// authorization (a CRON_SECRET bearer check) and never read a session
// cookie, which is why skipping the session refresh costs nothing.
const CRON_PREFIX = "/api/cron/";

export function isInstanceExemptPath(pathname: string): boolean {
  return pathname === "/api/cron" || pathname.startsWith(CRON_PREFIX);
}
