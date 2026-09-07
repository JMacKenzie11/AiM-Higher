import "server-only";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runWithInstance } from "./context";
import {
  listActiveInstances,
  lookupInstance,
  type ActiveInstanceRow,
} from "./registry";
import type { InstanceConfig } from "./types";

// Runs one job against every active instance.
//
// A scheduled job used to be a single pass over a single database.
// With more than one live instance that is no longer the job: the
// same work has to happen everywhere, and the run has to say what it
// did on each one.
//
// Three properties matter more than convenience here.
//
// ISOLATION. One instance failing must not stop the others. A bad
// Drive token on one customer cannot be allowed to mean nobody's
// transcripts get ingested that quarter-hour. Every instance runs
// inside its own try/catch and the loop always finishes.
//
// LOUDNESS. The counterpart to isolation: a caught failure must
// still make the whole run red. A cron that swallows one instance's
// error and returns 200 looks healthy in Vercel's cron history
// forever. Failures are collected, logged, sent to Sentry, and
// turned into a non-2xx by the caller.
//
// LEGIBILITY. The log lines are the only routine evidence that a run
// did real work, so they are built to be read in the Vercel log
// viewer rather than parsed:
//
//   [transcripts] promiseone: checked 4 sources, ingested 1
//   [transcripts] 2 instances: 2 ok, 0 failed
//
// A failure keeps the same shape with FAILED where the summary
// would be, so one search for "FAILED" across the log covers every
// job.

export type InstanceRunContext = {
  // The instance's service-role client, already built. Jobs whose
  // logic already takes a client use this directly.
  admin: SupabaseClient;
  instance: InstanceConfig;
};

export type InstanceJob<T> = {
  // The bracketed prefix on every line, e.g. "transcripts".
  job: string;
  run: (ctx: InstanceRunContext) => Promise<T>;
  // The human-readable half of this instance's line: what the job
  // actually did. Counts, not prose.
  line: (result: T) => string;
};

export type InstanceOutcome<T> = {
  subdomain: string;
  displayName: string;
  envPrefix: string;
  ok: boolean;
  result: T | null;
  error: string | null;
};

export type InstanceRunSummary<T> = {
  job: string;
  // False if any instance failed, if the registry could not be read,
  // or if it named no active instances at all.
  ok: boolean;
  instances: number;
  succeeded: number;
  failed: number;
  outcomes: Array<InstanceOutcome<T>>;
  // Exactly the lines that were logged, so the HTTP response carries
  // the same summary a human reads in the log viewer.
  lines: string[];
  // Set only when the run failed as a whole rather than per
  // instance: the registry was unreadable or empty.
  error: string | null;
};

export async function forEachActiveInstance<T>(
  spec: InstanceJob<T>,
): Promise<InstanceRunSummary<T>> {
  const { job } = spec;
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    console.log(line);
  };

  let rows: ActiveInstanceRow[];
  try {
    rows = await listActiveInstances();
  } catch (err) {
    // The registry itself is unreachable, so we do not know what we
    // were supposed to run against. Nothing ran; say so and go red.
    const message = errorMessage(err);
    log(`[${job}] registry lookup failed: ${message}`);
    log(`[${job}] 0 instances: 0 ok, 0 failed`);
    Sentry.captureException(err, { tags: { cron_job: job } });
    return empty(job, lines, message);
  }

  const targets = dedupeByEnvPrefix(rows, job, log);

  if (targets.length === 0) {
    // Not a quiet success. The registry always has at least the
    // primary instance in it, so an empty active list means the
    // lookup is broken (wrong control plane, a status column
    // migrated out from under us, RLS on the table) rather than that
    // there is genuinely no work.
    const message =
      "the registry returned no active instances, which should be impossible";
    log(`[${job}] ${message}`);
    log(`[${job}] 0 instances: 0 ok, 0 failed`);
    Sentry.captureException(new Error(`[${job}] ${message}`), {
      tags: { cron_job: job },
    });
    return empty(job, lines, message);
  }

  // Sequential, not Promise.all. Each instance's job is itself a
  // loop over that instance's companies making Supabase and model
  // calls; running every instance's loop concurrently multiplies
  // peak connection and rate-limit pressure for no deadline we are
  // trying to hit. Ordering also keeps the log readable.
  const outcomes: Array<InstanceOutcome<T>> = [];
  for (const row of targets) {
    outcomes.push(await runOneInstance(spec, row, log));
  }

  const succeeded = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.length - succeeded;
  log(
    `[${job}] ${outcomes.length} instances: ${succeeded} ok, ${failed} failed`,
  );

  return {
    job,
    ok: failed === 0,
    instances: outcomes.length,
    succeeded,
    failed,
    outcomes,
    lines,
    error: null,
  };
}

async function runOneInstance<T>(
  spec: InstanceJob<T>,
  row: ActiveInstanceRow,
  log: (line: string) => void,
): Promise<InstanceOutcome<T>> {
  const { job } = spec;

  // An isolation scope rather than a plain scope: the tags have to
  // apply to everything captured anywhere inside this instance's
  // work, including from code several awaits deep that has no idea
  // the fan-out exists. Without this an error in the Drive provider
  // arrives at Sentry with no way to tell whose Drive it was.
  return Sentry.withIsolationScope(async (scope) => {
    scope.setTag("instance", row.subdomain);
    scope.setTag("instance_env_prefix", row.envPrefix);
    scope.setTag("cron_job", job);

    try {
      const instance = await lookupInstance(row.subdomain);
      if (!instance) {
        // The row exists and says active, but its prefix resolves to
        // nothing. That is a deployment mistake: someone added the
        // registry row and did not add the environment variables, or
        // removed the variables and left the row. It is not a skip.
        // Skipping would mean this customer's transcripts silently
        // stop being ingested and every run still reports green.
        //
        // registry.ts has already logged which of the three
        // variables are missing; this names the instance and the
        // prefix so the two lines read together.
        throw new Error(
          `registered with env_prefix "${row.envPrefix}" but ` +
            `${row.envPrefix}_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY ` +
            "are not all set in this deployment",
        );
      }

      const admin = await createSupabaseAdminClient(instance);
      const result = await runWithInstance(instance, () =>
        spec.run({ admin, instance }),
      );

      log(`[${job}] ${row.subdomain}: ${spec.line(result)}`);
      return {
        subdomain: row.subdomain,
        displayName: row.displayName,
        envPrefix: row.envPrefix,
        ok: true,
        result,
        error: null,
      };
    } catch (err) {
      const message = errorMessage(err);
      log(`[${job}] ${row.subdomain}: FAILED: ${message}`);
      // Captured explicitly. The caller turns this into a 500, but
      // returning a 500 is not throwing, so nothing else would send
      // it to Sentry, and the tags above only help if an event
      // actually gets made.
      Sentry.captureException(err);
      return {
        subdomain: row.subdomain,
        displayName: row.displayName,
        envPrefix: row.envPrefix,
        ok: false,
        result: null,
        error: message,
      };
    }
  });
}

// Two registry rows can name the same env_prefix, and that means one
// database behind two hostnames rather than two databases. The apex
// convention makes this concrete: "@" and a "www" row for the same
// deployment would both resolve to PROD. Running the job twice there
// is not harmless. The performance sweep would create a second round
// of nudge commitments, and the transcript pass would race itself.
//
// Deduping by prefix matches what the migration runner does, for the
// same reason. It is logged rather than silent so the registry
// getting into that state is visible.
function dedupeByEnvPrefix(
  rows: ActiveInstanceRow[],
  job: string,
  log: (line: string) => void,
): ActiveInstanceRow[] {
  const seen = new Map<string, string>();
  const targets: ActiveInstanceRow[] = [];
  for (const row of rows) {
    const already = seen.get(row.envPrefix);
    if (already) {
      log(
        `[${job}] ${row.subdomain}: skipped, env_prefix "${row.envPrefix}" ` +
          `is the same database as "${already}", already running`,
      );
      continue;
    }
    seen.set(row.envPrefix, row.subdomain);
    targets.push(row);
  }
  return targets;
}

function empty<T>(
  job: string,
  lines: string[],
  error: string,
): InstanceRunSummary<T> {
  return {
    job,
    ok: false,
    instances: 0,
    succeeded: 0,
    failed: 0,
    outcomes: [],
    lines,
    error,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
