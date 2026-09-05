"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { trackAfter } from "@/lib/analytics/track";
import { scoreMeasureDraft, type MeasureCritique } from "./critique";
import type { MetricValueType, TargetDirection } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Batch weekly-value writer for the /measures batch page and the
// dashboard "Pending this week" widget. Skips blank rows so a user
// can log some measures now and come back to the rest later — no
// need to hold the whole set open.

export type LogEntryResult =
  | { ok: true; savedCount: number }
  | { ok: false; message: string };

export type MeasureEntryInput = {
  measureId: string;
  valueType: MetricValueType;
  rawValue: string;
};

export async function logMeasureEntriesAction(
  entries: MeasureEntryInput[],
  weekEnding: string
): Promise<LogEntryResult> {
  const session = await requireProfile();
  if (!weekEnding || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnding)) {
    return { ok: false, message: "Missing or invalid week." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const rows: Array<{
    measure_id: string;
    week_ending: string;
    value_number: number | null;
    value_text: string | null;
    entered_by: string;
  }> = [];

  for (const e of entries) {
    const raw = e.rawValue.trim();
    if (raw.length === 0) continue; // blank = skip, no clear
    let value_number: number | null = null;
    let value_text: string | null = null;
    if (e.valueType === "text") {
      value_text = raw;
    } else {
      const cleaned = raw.replace(/[^0-9.\-]/g, "");
      const n = cleaned.length > 0 ? Number(cleaned) : NaN;
      if (!Number.isFinite(n)) {
        return {
          ok: false,
          message: `Value for one of the measures isn't a number ("${raw}").`,
        };
      }
      value_number = n;
    }
    rows.push({
      measure_id: e.measureId,
      week_ending: weekEnding,
      value_number,
      value_text,
      entered_by: session.profile.id,
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

  revalidatePath("/measures");
  revalidatePath("/dashboard");
  revalidatePath("/chart");
  // Group by session company when known. Cross-company scoped users
  // (system admin / guide) don't have profile.company_id set, so
  // their events land ungrouped — small analytics blind spot, but
  // saves an extra measure→company lookup per save.
  const groups = session.profile.company_id
    ? { company: session.profile.company_id }
    : undefined;
  trackAfter(
    session.profile.id,
    "success_measure.updated",
    { entries_saved: rows.length },
    groups
    );
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

// Thin server-action wrapper around scoreMeasureDraft so the
// AddMetricRow (client) can request AI critique on blur without an
// API route boilerplate. Requires an authenticated session — the
// critique doesn't leak data across tenants because inputs are
// caller-provided strings and the caller only sees them if they're
// looking at that outcome's card in the first place.
export async function critiqueMeasureDraftAction(input: {
  description: string;
  target: string;
  valueType: MetricValueType;
  direction: TargetDirection;
  outcomeTitle: string;
  outcomeDescription: string | null;
}): Promise<MeasureCritique | null> {
  await requireProfile();
  // Cheap short-circuit: nothing to critique for an empty description.
  if (!input.description.trim()) return null;
  return await scoreMeasureDraft(input);
}
