"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MetricValueType } from "@/lib/types";

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

  const supabase = await createSupabaseServerClient();
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

  const { error } = await supabase
    .from("success_measure_entries")
    .upsert(rows, { onConflict: "measure_id,week_ending" });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/measures");
  revalidatePath("/dashboard");
  revalidatePath("/chart");
  return { ok: true, savedCount: rows.length };
}
