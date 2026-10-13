import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionProfile } from "@/lib/auth/current-user";
import type { MetricValueType } from "@/lib/types";
import {
  parseScale,
  parseTypedNumber,
  toStoredNumber,
  type MeasureScale,
} from "./value-format";

// WRITING WEEKLY MEASURE VALUES: the rules and the write, on a client
// it is handed.
//
// logMeasureEntriesAction (actions.ts) is the /measures grid's
// wrapper: it signs the caller in from the request, then refreshes the
// pages and records the event after a save. Nothing here reads a
// cookie or a request, so a caller outside a page request (an outside
// assistant acting as the person) writes through the same rules on a
// client signed in as that person. The entry rules decide who may
// write which measure; the database stamps entered_by (0268).

export type LogEntryResult =
  | { ok: true; savedCount: number }
  | { ok: false; message: string };

export type MeasureEntryInput = {
  measureId: string;
  valueType: MetricValueType;
  // The unit the box was typed in. Storage is always the true
  // number, so 18 on a millions measure is stored as 18000000 —
  // which is also what an external pull writes for that week, so
  // both paths land on one figure. See measures/value-format.ts.
  scale?: MeasureScale;
  rawValue: string;
  // Which week this value belongs to. Defaults to the batch's week.
  //
  // A WEEK STAYS OPEN UNTIL THE END OF THE FOLLOWING ONE, so a save
  // can carry two weeks at once: the current one and the one that
  // just closed. Before this, a batch was one week and the page only
  // offered the current column, which put it at odds with the
  // Saturday nudge: that asks for the week that just CLOSED, due the
  // coming Friday, and following it typed the number into the wrong
  // week because the right one was already read-only.
  weekEnding?: string;
};

// The client must be signed in as `profile`.
export type MeasureEntryWriter = {
  db: SupabaseClient;
  profile: SessionProfile;
};

export async function writeMeasureEntries(
  writer: MeasureEntryWriter,
  entries: MeasureEntryInput[],
  weekEnding: string
): Promise<LogEntryResult> {
  if (!weekEnding || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnding)) {
    return { ok: false, message: "Missing or invalid week." };
  }

  const { db: supabase, profile } = writer;
  const rows: Array<{
    measure_id: string;
    week_ending: string;
    value_number: number | null;
    value_text: string | null;
    entered_by: string;
    origin: null;
    pulled_at: null;
  }> = [];

  for (const e of entries) {
    const raw = e.rawValue.trim();
    if (raw.length === 0) continue; // blank = skip, no clear
    const week = e.weekEnding ?? weekEnding;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
      return { ok: false, message: "Missing or invalid week." };
    }
    let value_number: number | null = null;
    let value_text: string | null = null;
    if (e.valueType === "text") {
      value_text = raw;
    } else {
      const typed = parseTypedNumber(raw);
      if (typed === null) {
        return {
          ok: false,
          message: `Value for one of the measures isn't a number ("${raw}").`,
        };
      }
      value_number = toStoredNumber(typed, e.valueType, parseScale(e.scale));
    }
    rows.push({
      measure_id: e.measureId,
      week_ending: week,
      value_number,
      value_text,
      entered_by: profile.id,
      // Explicitly null, not omitted. This is an upsert on
      // (measure_id, week_ending), and an upsert only writes the
      // columns in its payload — so omitting these would leave a
      // previously-pulled week still tagged "Pulled" over a number a
      // person had just typed by hand. A manual entry clears the
      // tag, which is the same rule as manual-wins pointing the
      // other way. Migration 0212.
      origin: null,
      pulled_at: null,
    });
  }

  if (rows.length === 0) return { ok: true, savedCount: 0 };

  // One retry on Postgres statement timeout — Supabase dev
  // connections occasionally cold-start slow enough to trip the
  // default statement_timeout on the first query. Upsert is
  // idempotent on (measure_id, week_ending) so a retry is safe.
  let attempt = 0;
  let lastError: { message?: string; code?: string } | null = null;
  while (attempt < 2) {
    const { error } = await supabase
      .from("success_measure_entries")
      .upsert(rows, { onConflict: "measure_id,week_ending" });
    if (!error) {
      lastError = null;
      break;
    }
    lastError = error;
    if (!isStatementTimeout(error)) break;
    attempt += 1;
  }
  if (lastError) {
    if (isStatementTimeout(lastError)) {
      return {
        ok: false,
        message:
          "The database took too long to respond. Try again in a moment.",
      };
    }
    return { ok: false, message: lastError.message ?? "Save failed." };
  }

  return { ok: true, savedCount: rows.length };
}

// Postgres cancels a query that exceeds statement_timeout with
// SQLSTATE 57014. The Supabase JS client surfaces the raw error
// text; we key off the message rather than a numeric code because
// the code isn't always attached to the returned error.
function isStatementTimeout(err: { message?: string; code?: string }): boolean {
  const msg = (err.message ?? "").toLowerCase();
  return (
    err.code === "57014" ||
    msg.includes("statement timeout") ||
    msg.includes("canceling statement")
  );
}
