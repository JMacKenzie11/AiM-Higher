import { AsyncLocalStorage } from "node:async_hooks";

import type { InstanceConfig } from "./types";

// The instance a piece of background work is currently running for.
//
// Every request-scoped caller gets its instance from a header that
// middleware attached (see current.ts). Scheduled work has no request
// and no hostname, so before the cron fan-out there was exactly one
// answer per deployment, named by environment variable.
//
// Fan-out breaks that: one invocation now runs the same job against
// several databases in turn, and the code doing the work has to be
// told which one it is on. The obvious way to do that is to pass a
// Supabase client down through every function. The weekend jobs
// already do, because their entry points take an `admin` argument.
// The transcript pipeline does not: ingest, the Drive provider,
// analyze and similarity each build their own admin client from
// getCurrentInstanceConfig(), nine call sites over five modules,
// several of them behind provider indirection.
//
// Threading a client through all of those would work, but it fails
// in the worst possible direction. A call site that got missed would
// not break; it would keep calling getCurrentInstanceConfig(), fall
// through to the PROD_* variables, and quietly do one customer's
// work against another customer's database. That is the exact bug
// the fallback in current.ts was hardened against, and a refactor
// that reintroduces it silently is not worth the tidier signatures.
//
// So the instance travels in an async context instead. The fan-out
// helper opens the scope, everything awaited inside it sees the same
// instance, and a call site that was never updated is still correct
// rather than silently wrong. AsyncLocalStorage is per async
// execution, so two instances never see each other's scope, and the
// fan-out runs them sequentially anyway.

const storage = new AsyncLocalStorage<InstanceConfig>();

// Runs fn with `instance` as the ambient instance for everything it
// awaits. Returns whatever fn returns.
export function runWithInstance<T>(
  instance: InstanceConfig,
  fn: () => T,
): T {
  return storage.run(instance, fn);
}

// The ambient instance, or null outside any fan-out scope. Null is
// the normal case: ordinary requests resolve by header instead.
export function instanceFromContext(): InstanceConfig | null {
  return storage.getStore() ?? null;
}
