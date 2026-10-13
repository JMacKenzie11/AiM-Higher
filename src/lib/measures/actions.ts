"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { trackAfter } from "@/lib/analytics/track";
import { scoreMeasureDraft, type MeasureCritique } from "./critique";
import type { MetricValueType, TargetDirection } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import {
  writeMeasureEntries,
  type LogEntryResult,
  type MeasureEntryInput,
} from "./entries";

// Batch weekly-value writer for the /measures batch page and the
// dashboard "Pending this week" widget. Skips blank rows so a user
// can log some measures now and come back to the rest later — no
// need to hold the whole set open.

export type { LogEntryResult, MeasureEntryInput };

export async function logMeasureEntriesAction(
  entries: MeasureEntryInput[],
  weekEnding: string
): Promise<LogEntryResult> {
  const session = await requireProfile();
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const result = await writeMeasureEntries({ db, profile: session.profile }, entries, weekEnding);
  if (!result.ok || result.savedCount === 0) return result;

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
    { entries_saved: result.savedCount },
    groups
    );
  return result;
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
