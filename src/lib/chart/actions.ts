"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth/current-user";
import { scopedCompanyId } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { scoreMeasureTarget } from "@/lib/measures/target-check";
import { nullableString } from "@/lib/utils";
import type {
  FunctionNode,
  FunctionOutcome,
  FunctionRole,
  MetricValueType,
  SuccessMeasure,
  SuccessMeasureEntry,
  TargetDirection,
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

function parseTargetDirection(raw: string): TargetDirection {
  return raw === "lower_is_better" ? "lower_is_better" : "higher_is_better";
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

// Bulk reorder for a slice of siblings. Called by the drag-and-drop
// UI after a drop lands. The caller sends every sibling in the new
// order (root list or one parent's children) with fresh sort_order
// values 0..N-1. RLS on functions_update gates access to the
// company; we simply loop the updates.
export async function reorderFunctionsAction(
  updates: Array<{ id: string; sort_order: number }>
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireRole(["system_admin", "company_admin"]);
  if (updates.length === 0) return { ok: true };

  const supabase = await createSupabaseServerClient();
  const results = await Promise.all(
    updates.map((u) =>
      supabase
        .from("functions")
        .update({ sort_order: u.sort_order })
        .eq("id", u.id)
    )
  );
  const failure = results.find((r) => r.error);
  if (failure?.error) {
    return { ok: false, message: "Couldn't save the new order." };
  }
  revalidatePath("/chart");
  return { ok: true };
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

// ---- Function roles (R&R) --------------------------------------
// Every function has a trigger-created default role holding
// "Lead, Track, Decide" (is_default=true) — RLS blocks update and
// delete on that row. User-added rows below can be freely edited.

export async function createFunctionRoleAction(
  _prev: ChartResult<FunctionRole> | undefined,
  formData: FormData
): Promise<ChartResult<FunctionRole>> {
  await requireRole(["system_admin", "company_admin"]);
  const functionId = String(formData.get("function_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = nullableString(formData.get("body"));
  if (!functionId || !title) {
    return { ok: false, message: "Missing function or title." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("function_roles")
    .select("sort_order")
    .eq("function_id", functionId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort =
    existing && existing.length > 0 ? (existing[0].sort_order ?? 0) + 1 : 1;

  const { data, error } = await supabase
    .from("function_roles")
    .insert({
      function_id: functionId,
      title,
      body,
      sort_order: nextSort,
      is_default: false,
    })
    .select("*")
    .single<FunctionRole>();
  if (error || !data) return { ok: false, message: "Couldn't add that." };
  revalidatePath("/chart");
  revalidatePath(`/chart/function/${functionId}`);
  return { ok: true, item: data };
}

export async function updateFunctionRoleAction(
  _prev: ChartResult<FunctionRole> | undefined,
  formData: FormData
): Promise<ChartResult<FunctionRole>> {
  await requireRole(["system_admin", "company_admin"]);
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = nullableString(formData.get("body"));
  if (!id || !title) return { ok: false, message: "Missing title or id." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("function_roles")
    .update({ title, body })
    .eq("id", id)
    .eq("is_default", false)
    .select("*")
    .single<FunctionRole>();
  if (error || !data) {
    return { ok: false, message: "Couldn't save (the default role is locked)." };
  }
  revalidatePath("/chart");
  revalidatePath(`/chart/function/${data.function_id}`);
  return { ok: true, item: data };
}

// Lightweight inline rename — updates title only, leaves body intact.
// Used by the click-to-edit affordance on the roles list where the
// row shows just the title and there's no body field to submit.
export async function renameFunctionRoleAction(
  roleId: string,
  newTitle: string
): Promise<ChartResult<FunctionRole>> {
  await requireRole(["system_admin", "company_admin"]);
  const title = newTitle.trim();
  if (!roleId || !title) return { ok: false, message: "Title can't be empty." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("function_roles")
    .update({ title })
    .eq("id", roleId)
    .eq("is_default", false)
    .select("*")
    .single<FunctionRole>();
  if (error || !data) {
    return { ok: false, message: "Couldn't rename (the default role is locked)." };
  }
  revalidatePath("/chart");
  revalidatePath(`/chart/function/${data.function_id}`);
  return { ok: true, item: data };
}

export async function deleteFunctionRoleAction(
  roleId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();

  // Grab function_id first so we can revalidate the detail path even
  // after the row is gone. The is_default block also prevents the
  // baseline row from being deleted via a crafted request.
  const { data: role } = await supabase
    .from("function_roles")
    .select("function_id, is_default")
    .eq("id", roleId)
    .maybeSingle<Pick<FunctionRole, "function_id" | "is_default">>();
  if (!role) return { ok: false, message: "Not found." };
  if (role.is_default) {
    return { ok: false, message: "The default role can't be deleted." };
  }

  const { error } = await supabase
    .from("function_roles")
    .delete()
    .eq("id", roleId)
    .eq("is_default", false);
  if (error) return { ok: false, message: "Couldn't delete." };
  revalidatePath("/chart");
  revalidatePath(`/chart/function/${role.function_id}`);
  return { ok: true };
}

// Hard delete. FKs cascade: sub-functions, outcomes, measures, and
// weekly entries all go with it. Admin-only via RLS + the role check
// here.
export async function deleteFunctionAction(
  functionId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("functions")
    .delete()
    .eq("id", functionId);
  if (error) return { ok: false, message: "Couldn't delete that function." };
  revalidatePath("/chart");
  return { ok: true };
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
  await requireRole(["system_admin", "company_admin", "aims_guide"]);

  const outcomeId = String(formData.get("outcome_id") ?? "");
  if (!outcomeId) return { ok: false, message: "Missing parent outcome." };

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { ok: false, message: "Describe what you're measuring." };

  const target = nullableString(formData.get("target"));
  const valueType = parseValueType(String(formData.get("value_type") ?? "number"));
  const direction = parseTargetDirection(
    String(formData.get("target_direction") ?? "higher_is_better")
  );
  const autoTrack = formData.get("auto_track") !== null;

  // Derive the company_id via outcome → function so we can enforce
  // the performance_tracking gate without the caller knowing which
  // company it is.
  const supabase = await createSupabaseServerClient();
  const { data: outcome } = await supabase
    .from("function_outcomes")
    .select("function_id, functions!inner(company_id)")
    .eq("id", outcomeId)
    .maybeSingle<{
      function_id: string;
      functions: { company_id: string } | { company_id: string }[];
    }>();
  const companyId = outcome
    ? Array.isArray(outcome.functions)
      ? outcome.functions[0]?.company_id ?? null
      : outcome.functions?.company_id ?? null
    : null;
  if (
    companyId &&
    (await companyHasFeature(companyId, "performance_tracking"))
  ) {
    if (!target) {
      return {
        ok: false,
        message:
          "Performance tracking is on for this company — every measure needs a target.",
      };
    }
  }

  const { data, error } = await supabase
    .from("success_measures")
    .insert({
      outcome_id: outcomeId,
      description,
      target,
      value_type: valueType,
      target_direction: direction,
      auto_track: autoTrack,
    })
    .select("*")
    .single<SuccessMeasure>();
  if (error || !data) return { ok: false, message: "Couldn't add that measure." };

  // Coaching hint on the target, only when the flag is on and a
  // target was provided. Best-effort — a null result silently
  // skips the update. Runs after insert so a slow AI call doesn't
  // delay the save; the row is already visible.
  let finalRow: SuccessMeasure = data;
  if (
    target &&
    companyId &&
    (await companyHasFeature(companyId, "performance_tracking"))
  ) {
    const check = await scoreMeasureTarget({
      description,
      target,
      valueType,
      direction,
    });
    if (check) {
      const { data: updated } = await supabase
        .from("success_measures")
        .update({ target_hint: check.ok ? null : check.hint })
        .eq("id", data.id)
        .select("*")
        .single<SuccessMeasure>();
      if (updated) finalRow = updated;
    }
  }

  revalidatePath("/chart");
  return { ok: true, item: finalRow };
}

export async function updateMeasureAction(
  _prev: ChartResult<SuccessMeasure> | undefined,
  formData: FormData
): Promise<ChartResult<SuccessMeasure>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing measure id." };

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { ok: false, message: "Description can't be empty." };

  const target = nullableString(formData.get("target"));
  const valueType = parseValueType(String(formData.get("value_type") ?? "number"));
  const direction = parseTargetDirection(
    String(formData.get("target_direction") ?? "higher_is_better")
  );
  const autoTrack = formData.get("auto_track") !== null;

  const supabase = await createSupabaseServerClient();

  // Resolve company + enforce target when the flag is on. Same
  // derivation as create — walk measure → outcome → function.
  const { data: existing } = await supabase
    .from("success_measures")
    .select(
      "outcome_id, function_outcomes!inner(function_id, functions!inner(company_id))"
    )
    .eq("id", id)
    .maybeSingle<{
      outcome_id: string;
      function_outcomes:
        | {
            function_id: string;
            functions: { company_id: string } | { company_id: string }[];
          }
        | Array<{
            function_id: string;
            functions: { company_id: string } | { company_id: string }[];
          }>;
    }>();
  const outcomeRow = existing
    ? Array.isArray(existing.function_outcomes)
      ? existing.function_outcomes[0] ?? null
      : existing.function_outcomes
    : null;
  const fnRow = outcomeRow
    ? Array.isArray(outcomeRow.functions)
      ? outcomeRow.functions[0] ?? null
      : outcomeRow.functions
    : null;
  const companyId = fnRow?.company_id ?? null;
  if (
    companyId &&
    (await companyHasFeature(companyId, "performance_tracking"))
  ) {
    if (!target) {
      return {
        ok: false,
        message:
          "Performance tracking is on for this company — every measure needs a target.",
      };
    }
  }

  const { data, error } = await supabase
    .from("success_measures")
    .update({
      description,
      target,
      value_type: valueType,
      target_direction: direction,
      auto_track: autoTrack,
    })
    .eq("id", id)
    .select("*")
    .single<SuccessMeasure>();
  if (error || !data) return { ok: false, message: "Couldn't save changes." };

  // Re-score the target when the flag is on. If the new target
  // passes, this clears any stale hint from a prior save; if not,
  // the hint is refreshed to reflect the current target text.
  let finalRow: SuccessMeasure = data;
  if (
    target &&
    companyId &&
    (await companyHasFeature(companyId, "performance_tracking"))
  ) {
    const check = await scoreMeasureTarget({
      description,
      target,
      valueType,
      direction,
    });
    if (check) {
      const { data: updated } = await supabase
        .from("success_measures")
        .update({ target_hint: check.ok ? null : check.hint })
        .eq("id", data.id)
        .select("*")
        .single<SuccessMeasure>();
      if (updated) finalRow = updated;
    }
  } else if (!target) {
    // Target was cleared — drop any stale hint too.
    await supabase
      .from("success_measures")
      .update({ target_hint: null })
      .eq("id", data.id);
    finalRow = { ...data, target_hint: null };
  }

  revalidatePath("/chart");
  return { ok: true, item: finalRow };
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

  // One retry on Postgres statement timeout — see the same pattern
  // in logMeasureEntriesAction for the reasoning.
  let attempt = 0;
  let lastError: { message?: string; code?: string } | null = null;
  let data: SuccessMeasureEntry | null = null;
  while (attempt < 2) {
    const res = await supabase
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
    if (res.data && !res.error) {
      data = res.data;
      lastError = null;
      break;
    }
    lastError = res.error ?? { message: "Couldn't log that entry." };
    if (!isTimeoutError(lastError)) break;
    attempt += 1;
  }
  if (!data) {
    if (lastError && isTimeoutError(lastError)) {
      return {
        ok: false,
        message: "The database took too long to respond. Try again in a moment.",
      };
    }
    return { ok: false, message: lastError?.message ?? "Couldn't log that entry." };
  }

  revalidatePath("/chart");
  revalidatePath(`/chart/function/${fn.id}`);
  return { ok: true, item: data };
}

function isTimeoutError(err: { message?: string; code?: string }): boolean {
  const msg = (err.message ?? "").toLowerCase();
  return (
    err.code === "57014" ||
    msg.includes("statement timeout") ||
    msg.includes("canceling statement")
  );
}
