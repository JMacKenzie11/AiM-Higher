import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExternalMapping } from "./mapping";
import { failureSentence, runPull, type PullDecision } from "./pull";
import { isTransient } from "./schedule";
import { googleSheetReader, type SheetReader } from "./sheets";

// The pull, with its database handed to it.
//
// ---- WHY THIS EXISTS ------------------------------------------
//
// Phase 1's pull lived inside a server action and read the caller's
// cookie-scoped client from the request. A cron has no request, so
// the choice was to duplicate the pull for the scheduler or to give
// the pull a seam. Duplicating it would have meant two copies of the
// E4 rules and two copies of manual-wins, which is how a rule becomes
// two rules that disagree — the exact shape of the Follow-Through
// drift this codebase has already paid for once.
//
// So the client is an argument, following computeCompanyScorecard
// (companyId, admin): the action passes the caller's client, the cron
// passes the instance's admin client. Everything else is identical,
// including which rules apply, because there is only one copy of them.
//
// ---- WHAT DIFFERS BY PATH, AND WHERE IT IS DECIDED -------------
//
// Exactly one thing differs, and it is decided in the DATABASE, not
// here: which RPC is called.
//
//   caller     record_external_pull            actor = auth.uid(),
//                                              may replace a value a
//                                              previous pull wrote
//   scheduled  record_external_pull_scheduled  actor = NULL, replaces
//                                              nothing at all
//
// Both funnel into _record_external_pull, so manual-wins and the
// no-write rules cannot be skipped by either. This module chooses a
// function name; it does not choose a rule.
//
// The other consequence of the seam is worth stating because it is
// easy to get backwards. Under the CALLER's client, the entry write
// and the log insert are still subject to that caller's policies on
// the way in — the action cannot pull a measure the caller cannot
// see, because loadMeasureContext returns nothing. Under the ADMIN
// client, RLS filters nothing, and the only thing standing between
// the cron and a wrong company is that the inner function resolves
// the company from the measure itself. Which is why it does.

export type PullPath = "caller" | "scheduled";

export type PullOutcome =
  | "written"
  | "skipped_manual_exists"
  | "skipped_exists"
  | "skipped_stale"
  | "failed";

export type PullRun = {
  measureId: string;
  weekEnding: string;
  // What the DATABASE did, which is not always what this process
  // asked for: a written pull over a typed value comes back as
  // skipped_manual_exists, and a scheduled re-run comes back as
  // skipped_exists.
  outcome: PullOutcome;
  value: number | null;
  message: string;
  // How many times the sheet was read. 2 means a transient failure
  // was retried; the cron's summary line reports it so a flaky
  // source is visible before it becomes a broken one.
  attempts: number;
};

const RPC: Record<PullPath, string> = {
  caller: "record_external_pull",
  scheduled: "record_external_pull_scheduled",
};

export async function pullMeasureWeek(
  db: SupabaseClient,
  args: {
    path: PullPath;
    measureId: string;
    companyId: string;
    weekEnding: string;
    // null when the stored mapping will not parse. Still logged,
    // because a measure configured wrongly is precisely the thing
    // that otherwise goes unnoticed until somebody asks why a chart
    // stopped moving.
    mapping: ExternalMapping | null;
    rawSource?: unknown;
    // Injectable so every path through this function can be tested
    // without a Google account. Defaults to the company's real one.
    reader?: SheetReader;
  }
): Promise<PullRun> {
  const { path, measureId, weekEnding, mapping } = args;

  if (!mapping) {
    const claimed = (args.rawSource as { kind?: unknown } | null)?.kind;
    const kind = claimed === "snapshot" ? "snapshot" : "week_keyed";
    const outcome = await record(db, path, {
      measureId,
      weekEnding,
      kind,
      decision: {
        outcome: "failed",
        reason: "mapping_invalid",
        detail: { stored: args.rawSource ?? null, week_ending: weekEnding },
      },
    });
    return {
      measureId,
      weekEnding,
      outcome,
      value: null,
      message: failureSentence("mapping_invalid"),
      attempts: 0,
    };
  }

  const reader = args.reader ?? googleSheetReader(args.companyId);

  // ONE RETRY, AND ONLY FOR A TRANSIENT FAILURE. See isTransient:
  // reading a misspelled tab a second time produces the same answer a
  // second later. Nothing is written between the attempts, so a retry
  // cannot produce a duplicate.
  let decision = await runPull(reader, mapping, weekEnding);
  let attempts = 1;
  if (
    decision.outcome === "failed" &&
    decision.reason === "sheet_unreachable" &&
    isTransient(String(decision.detail.error ?? ""))
  ) {
    decision = await runPull(reader, mapping, weekEnding);
    attempts = 2;
  }

  const outcome = await record(db, path, {
    measureId,
    weekEnding,
    kind: mapping.kind,
    decision,
  });

  return {
    measureId,
    weekEnding,
    outcome,
    value: outcome === "written" && decision.outcome === "written" ? decision.value : null,
    message: messageFor(outcome, decision),
    attempts,
  };
}

export function messageFor(
  outcome: PullOutcome,
  decision: PullDecision
): string {
  switch (outcome) {
    case "written":
      return decision.outcome === "written"
        ? `Recorded ${decision.value} for the week.`
        : "Recorded for the week.";
    case "skipped_manual_exists":
      return "Nothing was changed. Somebody had already logged this week by hand, and a typed value always wins.";
    case "skipped_exists":
      return "Nothing was changed. This week had already been pulled.";
    case "skipped_stale":
      return "Nothing was recorded. The sheet's own freshness date does not cover this week yet.";
    case "failed":
      return decision.outcome === "failed"
        ? failureSentence(decision.reason)
        : "The pull did not complete.";
  }
}

async function record(
  db: SupabaseClient,
  path: PullPath,
  args: {
    measureId: string;
    weekEnding: string;
    kind: "week_keyed" | "snapshot";
    decision: PullDecision;
  }
): Promise<PullOutcome> {
  const { decision } = args;
  const { data, error } = await db.rpc(RPC[path], {
    p_measure_id: args.measureId,
    p_week_ending: args.weekEnding,
    p_mapping_kind: args.kind,
    p_outcome: decision.outcome,
    p_value: decision.outcome === "written" ? decision.value : null,
    p_failure_reason: decision.outcome === "failed" ? decision.reason : null,
    p_detail: decision.detail,
  });
  if (error) {
    // The receipt could not be written, which means nothing can be
    // said about what happened. Thrown rather than returned as a
    // quiet "failed": a failed pull is a normal outcome with a row
    // behind it, and this is the absence of one.
    throw new Error(`record_external_pull (${path}) failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return ((row as { outcome?: string } | null)?.outcome ??
    decision.outcome) as PullOutcome;
}
