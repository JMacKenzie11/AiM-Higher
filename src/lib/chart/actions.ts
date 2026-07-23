"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth/current-user";
import { scopedCompanyId } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { nullableString } from "@/lib/utils";
import type {
  FunctionNode,
  FunctionOutcome,
  MetricValueType,
  SuccessMeasure,
  SuccessMeasureEntry,
} from "@/lib/types";

// Chart write actions. RLS gates access (admin OR the function's
// leader for measure entries); the checks here surface friendly
// error messages rather than raw 403s.

export type ChartResult<T> =
  | { ok: true; item: T }
  | { ok: false; message: string };

const VALUE_TYPES: readonly MetricValueType[] = ["number", "percent", "text"];

function parseValueType(raw: string): MetricValueType {
  return VALUE_TYPES.includes(raw as MetricValueType)
    ? (raw as MetricValueType)
    : "number";
}

// ---- Functions --------------------------------------------------

export async function createFunctionAction(
  _prev: ChartResult<FunctionNode> | undefined,
  formData: FormData
): Promise<ChartResult<FunctionNode>> {
  const session = await requireRole(["system_admin", "company_admin"]);
  const companyId = await scopedCompanyId(
    session,
    String(formData.get("company_id") ?? "")
  );
  if (!companyId) return { ok: false, message: "Pick a company first." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Give the function a title." };

  const description = nullableString(formData.get("description"));
  const leadId = nullableString(formData.get("lead_id"));
  const trackId = nullableString(formData.get("track_id"));
  const decideId = nullableString(formData.get("decide_id"));
  const parentFunctionId = nullableString(formData.get("parent_function_id"));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("functions")
    .insert({
      company_id: companyId,
      parent_function_id: parentFunctionId,
      title,
      description,
      lead_id: leadId,
      track_id: trackId,
      decide_id: decideId,
    })
    .select("*")
    .single<FunctionNode>();
  if (error || !data) {
    return { ok: false, message: "Couldn't create that function." };
  }

  revalidatePath("/chart");
  return { ok: true, item: data };
}

export async function updateFunctionAction(
  _prev: ChartResult<FunctionNode> | undefined,
  formData: FormData
): Promise<ChartResult<FunctionNode>> {
  await requireRole(["system_admin", "company_admin"]);
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing function id." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Title can't be empty." };

  const description = nullableString(formData.get("description"));
  const leadId = nullableString(formData.get("lead_id"));
  const trackId = nullableString(formData.get("track_id"));
  const decideId = nullableString(formData.get("decide_id"));
  const parentFunctionId = nullableString(formData.get("parent_function_id"));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("functions")
    .update({
      title,
      description,
      lead_id: leadId,
      track_id: trackId,
      decide_id: decideId,
      parent_function_id: parentFunctionId,
    })
    .eq("id", id)
    .select("*")
    .single<FunctionNode>();
  if (error || !data) return { ok: false, message: "Couldn't save changes." };

  revalidatePath("/chart");
  revalidatePath(`/chart/function/${id}`);
  return { ok: true, item: data };
}

export async function archiveFunctionAction(
  functionId: string,
  archived: boolean
): Promise<ChartResult<FunctionNode>> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("functions")
    .update({ archived })
    .eq("id", functionId)
    .select("*")
    .single<FunctionNode>();
  if (error || !data) return { ok: false, message: "Couldn't archive." };
  revalidatePath("/chart");
  return { ok: true, item: data };
}

// Set one of the LTD roles (lead / track / decide). Passing null
// clears the explicit assignment; the app falls back to lead_id
// for track/decide when they're null.
export async function setFunctionRoleAction(
  functionId: string,
  role: "lead" | "track" | "decide",
  personId: string | null
): Promise<ChartResult<FunctionNode>> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const patch: Record<string, string | null> = {};
  patch[`${role}_id`] = personId;
  const { data, error } = await supabase
    .from("functions")
    .update(patch)
    .eq("id", functionId)
    .select("*")
    .single<FunctionNode>();
  if (error || !data) return { ok: false, message: `Couldn't update ${role}.` };
  revalidatePath("/chart");
  revalidatePath(`/chart/function/${functionId}`);
  return { ok: true, item: data };
}

// ---- Outcomes ---------------------------------------------------

export async function createOutcomeAction(
  _prev: ChartResult<FunctionOutcome> | undefined,
  formData: FormData
): Promise<ChartResult<FunctionOutcome>> {
  await requireRole(["system_admin", "company_admin"]);

  const functionId = String(formData.get("function_id") ?? "");
  if (!functionId) return { ok: false, message: "Missing parent function." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Give the outcome a title." };

  const description = nullableString(formData.get("description"));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("function_outcomes")
    .insert({ function_id: functionId, title, description })
    .select("*")
    .single<FunctionOutcome>();
  if (error || !data) return { ok: false, message: "Couldn't add that outcome." };

  revalidatePath("/chart");
  revalidatePath(`/chart/function/${functionId}`);
  return { ok: true, item: data };
}

export async function updateOutcomeAction(
  _prev: ChartResult<FunctionOutcome> | undefined,
  formData: FormData
): Promise<ChartResult<FunctionOutcome>> {
  await requireRole(["system_admin", "company_admin"]);
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing outcome id." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Title can't be empty." };
  const description = nullableString(formData.get("description"));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("function_outcomes")
    .update({ title, description })
    .eq("id", id)
    .select("*")
    .single<FunctionOutcome>();
  if (error || !data) return { ok: false, message: "Couldn't save changes." };

  revalidatePath("/chart");
  return { ok: true, item: data };
}

export async function archiveOutcomeAction(
  outcomeId: string,
  archived: boolean
): Promise<ChartResult<FunctionOutcome>> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("function_outcomes")
    .update({ archived })
    .eq("id", outcomeId)
    .select("*")
    .single<FunctionOutcome>();
  if (error || !data) return { ok: false, message: "Couldn't archive." };
  revalidatePath("/chart");
  return { ok: true, item: data };
}

// ---- Success measures -------------------------------------------

export async function createMeasureAction(
  _prev: ChartResult<SuccessMeasure> | undefined,
  formData: FormData
): Promise<ChartResult<SuccessMeasure>> {
  await requireRole(["system_admin", "company_admin"]);

  const outcomeId = String(formData.get("outcome_id") ?? "");
  if (!outcomeId) return { ok: false, message: "Missing parent outcome." };

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { ok: false, message: "Describe what you're measuring." };

  const target = nullableString(formData.get("target"));
  const valueType = parseValueType(String(formData.get("value_type") ?? "number"));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("success_measures")
    .insert({
      outcome_id: outcomeId,
      description,
      target,
      value_type: valueType,
    })
    .select("*")
    .single<SuccessMeasure>();
  if (error || !data) return { ok: false, message: "Couldn't add that measure." };

  revalidatePath("/chart");
  return { ok: true, item: data };
}

export async function updateMeasureAction(
  _prev: ChartResult<SuccessMeasure> | undefined,
  formData: FormData
): Promise<ChartResult<SuccessMeasure>> {
  await requireRole(["system_admin", "company_admin"]);
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing measure id." };

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { ok: false, message: "Description can't be empty." };

  const target = nullableString(formData.get("target"));
  const valueType = parseValueType(String(formData.get("value_type") ?? "number"));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("success_measures")
    .update({ description, target, value_type: valueType })
    .eq("id", id)
    .select("*")
    .single<SuccessMeasure>();
  if (error || !data) return { ok: false, message: "Couldn't save changes." };

  revalidatePath("/chart");
  return { ok: true, item: data };
}

export async function archiveMeasureAction(
  measureId: string,
  archived: boolean
): Promise<ChartResult<SuccessMeasure>> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("success_measures")
    .update({ archived })
    .eq("id", measureId)
    .select("*")
    .single<SuccessMeasure>();
  if (error || !data) return { ok: false, message: "Couldn't archive." };
  revalidatePath("/chart");
  return { ok: true, item: data };
}

// ---- Weekly measure entries -------------------------------------
// Admin OR the function's Lead / Track person may write these.
// RLS enforces it a second time.

export async function upsertMeasureEntryAction(
  measureId: string,
  weekEnding: string,
  rawValue: string
): Promise<ChartResult<SuccessMeasureEntry>> {
  const session = await requireProfile();

  const supabase = await createSupabaseServerClient();

  // Load the measure → outcome → function so we can (a) authorize and
  // (b) coerce the input based on the measure's value_type.
  const { data: measureRow } = await supabase
    .from("success_measures")
    .select(
      "id, value_type, outcome:function_outcomes!inner(function:functions!inner(id, company_id, lead_id, track_id))"
    )
    .eq("id", measureId)
    .maybeSingle<{
      id: string;
      value_type: MetricValueType;
      outcome: {
        function: {
          id: string;
          company_id: string;
          lead_id: string | null;
          track_id: string | null;
        };
      };
    }>();
  if (!measureRow) return { ok: false, message: "Measure not found." };

  const fn = measureRow.outcome.function;
  const role = session.profile.role;
  const isAdmin =
    role === "system_admin" ||
    (role === "company_admin" && session.profile.company_id === fn.company_id);
  const isLtd =
    fn.lead_id === session.profile.id || fn.track_id === session.profile.id;
  if (!isAdmin && !isLtd) {
    return {
      ok: false,
      message: "Only the function's Lead / Track / an admin can log this.",
    };
  }

  let value_number: number | null = null;
  let value_text: string | null = null;
  if (measureRow.value_type === "text") {
    value_text = rawValue.trim() || null;
  } else {
    const cleaned = rawValue.replace(/[^0-9.\-]/g, "");
    const n = cleaned.length > 0 ? Number(cleaned) : NaN;
    value_number = Number.isFinite(n) ? n : null;
  }

  const { data, error } = await supabase
    .from("success_measure_entries")
    .upsert(
      {
        measure_id: measureId,
        week_ending: weekEnding,
        value_number,
        value_text,
        entered_by: session.profile.id,
      },
      { onConflict: "measure_id,week_ending" }
    )
    .select("*")
    .single<SuccessMeasureEntry>();
  if (error || !data) return { ok: false, message: "Couldn't log that entry." };

  revalidatePath("/chart");
  revalidatePath(`/chart/function/${fn.id}`);
  return { ok: true, item: data };
}
