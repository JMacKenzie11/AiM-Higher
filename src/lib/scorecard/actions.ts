"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth/current-user";
import { scopedCompanyId } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { nullableString } from "@/lib/utils";
import type {
  FunctionalArea,
  MetricValueType,
  ScorecardEntry,
  ScorecardMetric,
} from "@/lib/types";

// Functional scorecard server actions — Section 4.8 + Section 5.
//
// Areas + metrics: admin only. Entries: admin OR the area's accountable
// person. RLS enforces this twice — the actions still check explicitly
// so the caller gets a nice message instead of a raw RLS 403.

export type AreaResult =
  | { ok: true; area: FunctionalArea }
  | { ok: false; message: string };
export type MetricResult =
  | { ok: true; metric: ScorecardMetric }
  | { ok: false; message: string };
export type EntryResult =
  | { ok: true; entry: ScorecardEntry }
  | { ok: false; message: string };

const VALUE_TYPES: readonly MetricValueType[] = ["number", "percent", "text"];

// =============================================================
// Functional Areas
// =============================================================

export async function createAreaAction(
  _prev: AreaResult | undefined,
  formData: FormData
): Promise<AreaResult> {
  const session = await requireRole(["system_admin", "company_admin"]);
  const companyId = scopedCompanyId(
    session,
    String(formData.get("company_id") ?? "")
  );
  if (!companyId) return { ok: false, message: "Pick a company first." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Give this area a name." };

  const accountableId = nullableString(formData.get("accountable_id"));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("functional_areas")
    .insert({ company_id: companyId, name, accountable_id: accountableId })
    .select("*")
    .single<FunctionalArea>();
  if (error || !data) {
    return { ok: false, message: "Couldn't create that area." };
  }

  revalidatePath("/scorecard");
  return { ok: true, area: data };
}

export async function updateAreaAction(
  _prev: AreaResult | undefined,
  formData: FormData
): Promise<AreaResult> {
  await requireRole(["system_admin", "company_admin"]);
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const accountableId = nullableString(formData.get("accountable_id"));
  if (!id || !name) return { ok: false, message: "Missing area name or id." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("functional_areas")
    .update({ name, accountable_id: accountableId })
    .eq("id", id)
    .select("*")
    .single<FunctionalArea>();
  if (error || !data) return { ok: false, message: "Couldn't save changes." };

  revalidatePath("/scorecard");
  return { ok: true, area: data };
}

export async function deleteAreaAction(
  areaId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("functional_areas")
    .delete()
    .eq("id", areaId);
  if (error) return { ok: false, message: "Couldn't delete that area." };
  revalidatePath("/scorecard");
  return { ok: true };
}

// =============================================================
// Metrics
// =============================================================

export async function createMetricAction(
  _prev: MetricResult | undefined,
  formData: FormData
): Promise<MetricResult> {
  const session = await requireRole(["system_admin", "company_admin"]);
  const companyId = scopedCompanyId(
    session,
    String(formData.get("company_id") ?? "")
  );
  if (!companyId) return { ok: false, message: "Pick a company first." };

  const functionalAreaId = String(formData.get("functional_area_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const target = nullableString(formData.get("target"));
  const valueTypeRaw = String(formData.get("value_type") ?? "number");
  const valueType: MetricValueType = VALUE_TYPES.includes(
    valueTypeRaw as MetricValueType
  )
    ? (valueTypeRaw as MetricValueType)
    : "number";

  if (!functionalAreaId) return { ok: false, message: "Pick an area." };
  if (!name) return { ok: false, message: "Give this metric a name." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("scorecard_metrics")
    .insert({
      company_id: companyId,
      functional_area_id: functionalAreaId,
      name,
      target,
      value_type: valueType,
    })
    .select("*")
    .single<ScorecardMetric>();
  if (error || !data) {
    return { ok: false, message: "Couldn't create that metric." };
  }

  revalidatePath("/scorecard");
  return { ok: true, metric: data };
}

export async function updateMetricAction(
  _prev: MetricResult | undefined,
  formData: FormData
): Promise<MetricResult> {
  await requireRole(["system_admin", "company_admin"]);
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const target = nullableString(formData.get("target"));
  const valueTypeRaw = String(formData.get("value_type") ?? "number");
  const valueType: MetricValueType = VALUE_TYPES.includes(
    valueTypeRaw as MetricValueType
  )
    ? (valueTypeRaw as MetricValueType)
    : "number";
  if (!id || !name) return { ok: false, message: "Missing metric name or id." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("scorecard_metrics")
    .update({ name, target, value_type: valueType })
    .eq("id", id)
    .select("*")
    .single<ScorecardMetric>();
  if (error || !data) return { ok: false, message: "Couldn't save changes." };

  revalidatePath("/scorecard");
  return { ok: true, metric: data };
}

export async function archiveMetricAction(
  metricId: string,
  archived: boolean
): Promise<MetricResult> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("scorecard_metrics")
    .update({ archived })
    .eq("id", metricId)
    .select("*")
    .single<ScorecardMetric>();
  if (error || !data) return { ok: false, message: "Couldn't archive." };
  revalidatePath("/scorecard");
  return { ok: true, metric: data };
}

// =============================================================
// Entries — click-to-edit cell
// =============================================================

export async function upsertEntryAction(
  metricId: string,
  weekEnding: string,
  rawValue: string
): Promise<EntryResult> {
  const session = await requireProfile();

  const supabase = await createSupabaseServerClient();

  // Load the metric (and its area) so we can:
  //   a) check company / accountable authorization
  //   b) coerce the input based on value_type
  const { data: metric } = await supabase
    .from("scorecard_metrics")
    .select("id, company_id, functional_area_id, value_type")
    .eq("id", metricId)
    .maybeSingle<
      Pick<
        ScorecardMetric,
        "id" | "company_id" | "functional_area_id" | "value_type"
      >
    >();
  if (!metric) return { ok: false, message: "That metric isn't accessible." };

  const role = session.profile.role;
  const isAdmin =
    role === "system_admin" ||
    (role === "company_admin" &&
      session.profile.company_id === metric.company_id);

  if (!isAdmin) {
    const { data: area } = await supabase
      .from("functional_areas")
      .select("accountable_id, company_id")
      .eq("id", metric.functional_area_id)
      .maybeSingle<Pick<FunctionalArea, "accountable_id" | "company_id">>();
    if (!area) return { ok: false, message: "Not authorized." };
    if (area.accountable_id !== session.profile.id) {
      return { ok: false, message: "Only this area's accountable person can edit these cells." };
    }
  }

  const trimmed = rawValue.trim();
  const isEmpty = trimmed.length === 0;

  // If the caller cleared the cell, delete the row (matches "empty cell"
  // semantics — the unique index means there's at most one to delete).
  if (isEmpty) {
    const { error: deleteError } = await supabase
      .from("scorecard_entries")
      .delete()
      .eq("metric_id", metricId)
      .eq("week_ending", weekEnding);
    if (deleteError) {
      return { ok: false, message: "Couldn't clear that cell." };
    }
    revalidatePath("/scorecard");
    // Return a synthetic empty entry so useActionState can render.
    return {
      ok: true,
      entry: {
        id: "",
        company_id: metric.company_id,
        metric_id: metricId,
        week_ending: weekEnding,
        value_number: null,
        value_text: null,
        entered_by: session.profile.id,
        created_at: "",
        updated_at: "",
      },
    };
  }

  let payload: Partial<ScorecardEntry> = {
    company_id: metric.company_id,
    metric_id: metricId,
    week_ending: weekEnding,
    entered_by: session.profile.id,
    value_number: null,
    value_text: null,
  };

  if (metric.value_type === "text") {
    payload.value_text = trimmed;
  } else {
    // "number" and "percent" both stored numerically. Strip a trailing %.
    const cleaned = trimmed.replace(/%$/, "").trim();
    const numeric = Number(cleaned);
    if (!Number.isFinite(numeric)) {
      return { ok: false, message: "Enter a number for this metric." };
    }
    payload.value_number = numeric;
  }

  const { data, error } = await supabase
    .from("scorecard_entries")
    .upsert(payload as ScorecardEntry, { onConflict: "metric_id,week_ending" })
    .select("*")
    .single<ScorecardEntry>();
  if (error || !data) {
    return { ok: false, message: "Couldn't save that value." };
  }

  revalidatePath("/scorecard");
  return { ok: true, entry: data };
}
