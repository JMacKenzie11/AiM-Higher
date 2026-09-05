"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth/current-user";
import { isAdminForCompany, scopedCompanyId } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { companyHasFeature } from "@/lib/subscriptions/service";
import {
  CSF_AS_OUTCOME_COLUMNS,
  cascadeArchiveKpis,
  csfAsOutcome,
  outcomeFieldsToCsf,
  type CsfRow,
} from "@/lib/measures/csf-as-outcome";
import { scoreMeasureTarget } from "@/lib/measures/target-check";
import { nullableString } from "@/lib/utils";
import type {
  FunctionCompetency,
  FunctionDecisionRight,
  FunctionNode,
  FunctionOutcome,
  FunctionRole,
  MetricValueType,
  SuccessMeasure,
  SuccessMeasureEntry,
  TargetDirection,
  UpdateFrequency,
} from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

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

// Frequency arrives from a select, so anything unexpected means a
// tampered or stale form. Fall back to weekly rather than trusting it.
function parseUpdateFrequency(raw: string): UpdateFrequency {
  return raw === "biweekly" || raw === "monthly" ? raw : "weekly";
}

function parseTargetDirection(raw: string): TargetDirection {
  return raw === "lower_is_better" ? "lower_is_better" : "higher_is_better";
}

// ---- Functions --------------------------------------------------

export async function createFunctionAction(
  _prev: ChartResult<FunctionNode> | undefined,
  formData: FormData
): Promise<ChartResult<FunctionNode>> {
  const session = await requireRole(["system_admin", "company_admin", "aims_guide"]);
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

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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

// Lightweight rename — updates only the title, leaves every other
// field intact. Used by the click-to-edit affordance on the
// function detail page's H1 so a caller doesn't need to round-trip
// the full form. Same admin gate as updateFunctionAction; applies
// to every function including the seed Visionary/Integrator boxes
// so a company can localise the language.
export async function renameFunctionAction(
  functionId: string,
  newTitle: string
): Promise<ChartResult<FunctionNode>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const title = newTitle.trim();
  if (!functionId || !title) {
    return { ok: false, message: "Title can't be empty." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("functions")
    .update({ title })
    .eq("id", functionId)
    .select("*")
    .single<FunctionNode>();
  if (error || !data) {
    return { ok: false, message: "Couldn't rename that function." };
  }

  revalidatePath("/chart");
  revalidatePath(`/chart/function/${functionId}`);
  return { ok: true, item: data };
}

export async function updateFunctionAction(
  _prev: ChartResult<FunctionNode> | undefined,
  formData: FormData
): Promise<ChartResult<FunctionNode>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing function id." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Title can't be empty." };

  const description = nullableString(formData.get("description"));
  const leadId = nullableString(formData.get("lead_id"));
  const trackId = nullableString(formData.get("track_id"));
  const decideId = nullableString(formData.get("decide_id"));
  const parentFunctionId = nullableString(formData.get("parent_function_id"));

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  if (updates.length === 0) return { ok: true };

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const functionId = String(formData.get("function_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = nullableString(formData.get("body"));
  if (!functionId || !title) {
    return { ok: false, message: "Missing function or title." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = nullableString(formData.get("body"));
  if (!id || !title) return { ok: false, message: "Missing title or id." };

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const title = newTitle.trim();
  if (!roleId || !title) return { ok: false, message: "Title can't be empty." };

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

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
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
  await requireRole(["system_admin", "company_admin", "aims_guide"]);

  const functionId = String(formData.get("function_id") ?? "");
  if (!functionId) return { ok: false, message: "Missing parent function." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Give the outcome a title." };

  const description = nullableString(formData.get("description"));

  // An outcome is a critical success factor: one row in
  // success_measures, tagged csf. There is no second table to keep in
  // step any more.
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("success_measures")
    .insert({
      function_id: functionId,
      kind: "csf",
      ...outcomeFieldsToCsf({ title, description }),
    })
    .select(CSF_AS_OUTCOME_COLUMNS)
    .single<CsfRow>();
  if (error || !data) return { ok: false, message: "Couldn't add that outcome." };
  const item = csfAsOutcome(data);

  revalidatePath("/chart");
  revalidatePath(`/chart/function/${functionId}`);
  revalidatePath("/measures");
  return { ok: true, item };
}

export async function updateOutcomeAction(
  _prev: ChartResult<FunctionOutcome> | undefined,
  formData: FormData
): Promise<ChartResult<FunctionOutcome>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing outcome id." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Title can't be empty." };
  const description = nullableString(formData.get("description"));

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("success_measures")
    .update(outcomeFieldsToCsf({ title, description }))
    .eq("id", id)
    .eq("kind", "csf")
    .select(CSF_AS_OUTCOME_COLUMNS)
    .single<CsfRow>();
  if (error || !data) return { ok: false, message: "Couldn't save changes." };

  revalidatePath("/chart");
  revalidatePath("/measures");
  return { ok: true, item: csfAsOutcome(data) };
}

// Lightweight inline rename for the outcome title. Mirrors
// renameFunctionRoleAction — updates title only, leaves description
// (the "why this matters" copy) intact. Used by the click-to-edit
// affordance on the Success Measure card header. The full-form
// updateOutcomeAction stays for the multi-field edit flow.
export async function renameOutcomeAction(
  outcomeId: string,
  newTitle: string
): Promise<ChartResult<FunctionOutcome>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const title = newTitle.trim();
  if (!outcomeId || !title) {
    return { ok: false, message: "Title can't be empty." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("success_measures")
    .update(outcomeFieldsToCsf({ title }))
    .eq("id", outcomeId)
    .eq("kind", "csf")
    .select(CSF_AS_OUTCOME_COLUMNS)
    .single<CsfRow>();
  if (error || !data) return { ok: false, message: "Couldn't rename." };

  revalidatePath("/chart");
  revalidatePath("/measures");
  return { ok: true, item: csfAsOutcome(data) };
}

// Inline edit for the why-this-matters note, saved on blur. Mirrors
// renameOutcomeAction: one field, no form. Both fields on a critical
// success factor are now edited in place on the card, which is why
// the Details drawer is gone — a two-field modal for two pieces of
// text people mostly skim is more ceremony than the edit deserves.
export async function updateOutcomeDetailAction(
  outcomeId: string,
  newDetail: string
): Promise<ChartResult<FunctionOutcome>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  if (!outcomeId) return { ok: false, message: "Missing id." };

  // Empty clears the note rather than failing. Unlike the title,
  // blank is a legitimate value here.
  const detail = newDetail.trim() || null;

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("success_measures")
    .update(outcomeFieldsToCsf({ description: detail }))
    .eq("id", outcomeId)
    .eq("kind", "csf")
    .select(CSF_AS_OUTCOME_COLUMNS)
    .single<CsfRow>();
  if (error || !data) return { ok: false, message: "Couldn't save that." };

  revalidatePath("/chart");
  revalidatePath("/measures");
  return { ok: true, item: csfAsOutcome(data) };
}

export async function archiveOutcomeAction(
  outcomeId: string,
  archived: boolean
): Promise<ChartResult<FunctionOutcome>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("success_measures")
    .update({ archived })
    .eq("id", outcomeId)
    .eq("kind", "csf")
    .select(CSF_AS_OUTCOME_COLUMNS)
    .single<CsfRow>();
  if (error || !data) return { ok: false, message: "Couldn't archive." };

  // Archiving a CSF archives the KPIs beneath it, so nothing is left
  // parentless and invisible while still collecting values. Only on
  // the way in: restoring a CSF does not restore its KPIs.
  if (archived) await cascadeArchiveKpis(supabase, outcomeId);

  revalidatePath("/chart");
  revalidatePath("/measures");
  return { ok: true, item: csfAsOutcome(data) };
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
  const updateFrequency = parseUpdateFrequency(
    String(formData.get("update_frequency") ?? "weekly")
  );

  // Derive the company_id via outcome → function so we can enforce
  // the performance_tracking gate without the caller knowing which
  // company it is.
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: outcome } = await supabase
    .from("success_measures")
    .select("function_id, functions!inner(company_id)")
    .eq("id", outcomeId)
    .eq("kind", "csf")
    .maybeSingle<{
      function_id: string;
      functions: { company_id: string } | { company_id: string }[];
    }>();
  // Bail here rather than at the insert. Since migration 0168
  // function_id is NOT NULL, so a KPI whose parent could not be
  // resolved — a stale id, an archived CSF, a row RLS will not show
  // this caller — used to fail on the constraint and come back as
  // the generic "Couldn't add that measure", which says nothing
  // about what went wrong. Before 0168 it was worse: it inserted an
  // orphan with a null function that no policy could see again.
  if (!outcome?.function_id) {
    return {
      ok: false,
      message: "Couldn't find the critical success factor for this KPI.",
    };
  }

  const companyId = Array.isArray(outcome.functions)
    ? outcome.functions[0]?.company_id ?? null
    : outcome.functions?.company_id ?? null;
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
      // A KPI belongs to a function directly and reaches its CSF
      // through the link table below, which is many-to-many by
      // design even though the UI allows one parent today.
      function_id: outcome.function_id,
      kind: "kpi",
      description,
      target,
      value_type: valueType,
      target_direction: direction,
      auto_track: autoTrack,
      update_frequency: updateFrequency,
    })
    .select("*")
    .single<SuccessMeasure>();
  if (error || !data) return { ok: false, message: "Couldn't add that measure." };

  // Record which CSF this KPI drives. Without the link the measure
  // exists but hangs off nothing, so no read path finds it.
  const { error: linkError } = await supabase
    .from("csf_kpi_links")
    .insert({ csf_id: outcomeId, kpi_id: data.id });
  if (linkError) {
    // Every read path finds a KPI through this link, so a measure
    // without one is invisible: it would sit in the table collecting
    // nothing while the leader who just created it sees no new row
    // and adds it again. Remove it rather than leave that behind.
    await supabase.from("success_measures").delete().eq("id", data.id);
    return { ok: false, message: "Couldn't attach that KPI. Try again." };
  }

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
  revalidatePath("/measures");
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
  const updateFrequency = parseUpdateFrequency(
    String(formData.get("update_frequency") ?? "weekly")
  );

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  // Resolve company + enforce target when the flag is on. A measure
  // reaches its function directly now, so this is one join rather
  // than the two the old outcome hop needed.
  const { data: existing } = await supabase
    .from("success_measures")
    .select("function_id, kind, functions!inner(company_id)")
    .eq("id", id)
    .maybeSingle<{
      function_id: string;
      kind: "csf" | "kpi";
      functions: { company_id: string } | { company_id: string }[];
    }>();
  const fnRow = existing
    ? Array.isArray(existing.functions)
      ? existing.functions[0] ?? null
      : existing.functions
    : null;
  const companyId = fnRow?.company_id ?? null;
  // A KPI needs a target: a leading measure without one says nothing.
  // A critical success factor does not. Decided 2026-09-04 — a
  // company may name the results it owns before it knows what good
  // looks like, and forcing a number there produces a made-up one.
  // This action now edits both kinds, so the rule has to know which.
  if (
    existing?.kind !== "csf" &&
    companyId &&
    (await companyHasFeature(companyId, "performance_tracking"))
  ) {
    if (!target) {
      return {
        ok: false,
        message:
          "Performance tracking is on for this company — every KPI needs a target.",
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
      update_frequency: updateFrequency,
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
  revalidatePath("/measures");
  return { ok: true, item: finalRow };
}

export async function archiveMeasureAction(
  measureId: string,
  archived: boolean
): Promise<ChartResult<SuccessMeasure>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("success_measures")
    .update({ archived })
    .eq("id", measureId)
    .select("*")
    .single<SuccessMeasure>();
  if (error || !data) return { ok: false, message: "Couldn't archive." };
  revalidatePath("/chart");
  revalidatePath("/measures");
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

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  // Load the measure and its function so we can (a) authorize and
  // (b) coerce the input based on the measure's value_type. Critical
  // success factors and KPIs both hang off a function directly, which
  // is what makes one query serve both kinds.
  const { data: measureRow } = await supabase
    .from("success_measures")
    .select(
      "id, value_type, function:functions!inner(id, company_id, lead_id, track_id)"
    )
    .eq("id", measureId)
    .maybeSingle<{
      id: string;
      value_type: MetricValueType;
      function:
        | {
            id: string;
            company_id: string;
            lead_id: string | null;
            track_id: string | null;
          }
        | Array<{
            id: string;
            company_id: string;
            lead_id: string | null;
            track_id: string | null;
          }>;
    }>();
  if (!measureRow) return { ok: false, message: "Measure not found." };

  const fn = Array.isArray(measureRow.function)
    ? measureRow.function[0]
    : measureRow.function;
  if (!fn) return { ok: false, message: "Measure not found." };
  const isAdmin = isAdminForCompany(session.profile, fn.company_id);
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
  revalidatePath("/measures");
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

// ---- Decision Rights & Competency Indicators --------------------
// Both tables share the same shape (function_id, title, body,
// sort_order) and same permission rules, so their CRUD actions
// mirror function_roles minus the is_default handling. Kept as
// concrete per-entity actions rather than a generic helper because
// there are only two and the R&R actions above set the pattern.

export async function createFunctionDecisionRightAction(
  _prev: ChartResult<FunctionDecisionRight> | undefined,
  formData: FormData
): Promise<ChartResult<FunctionDecisionRight>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const functionId = String(formData.get("function_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = nullableString(formData.get("body"));
  if (!functionId || !title) {
    return { ok: false, message: "Missing function or title." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: existing } = await supabase
    .from("function_decision_rights")
    .select("sort_order")
    .eq("function_id", functionId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort =
    existing && existing.length > 0 ? (existing[0].sort_order ?? 0) + 1 : 1;

  const { data, error } = await supabase
    .from("function_decision_rights")
    .insert({ function_id: functionId, title, body, sort_order: nextSort })
    .select("*")
    .single<FunctionDecisionRight>();
  if (error || !data) return { ok: false, message: "Couldn't add that." };
  revalidatePath(`/chart/function/${functionId}`);
  return { ok: true, item: data };
}

export async function renameFunctionDecisionRightAction(
  id: string,
  newTitle: string
): Promise<ChartResult<FunctionDecisionRight>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const title = newTitle.trim();
  if (!id || !title) return { ok: false, message: "Title can't be empty." };

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("function_decision_rights")
    .update({ title })
    .eq("id", id)
    .select("*")
    .single<FunctionDecisionRight>();
  if (error || !data) return { ok: false, message: "Couldn't rename." };
  revalidatePath(`/chart/function/${data.function_id}`);
  return { ok: true, item: data };
}

export async function deleteFunctionDecisionRightAction(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: row } = await supabase
    .from("function_decision_rights")
    .select("function_id")
    .eq("id", id)
    .maybeSingle<Pick<FunctionDecisionRight, "function_id">>();
  if (!row) return { ok: false, message: "Not found." };

  const { error } = await supabase
    .from("function_decision_rights")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't delete." };
  revalidatePath(`/chart/function/${row.function_id}`);
  return { ok: true };
}

export async function createFunctionCompetencyAction(
  _prev: ChartResult<FunctionCompetency> | undefined,
  formData: FormData
): Promise<ChartResult<FunctionCompetency>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const functionId = String(formData.get("function_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = nullableString(formData.get("body"));
  if (!functionId || !title) {
    return { ok: false, message: "Missing function or title." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: existing } = await supabase
    .from("function_competencies")
    .select("sort_order")
    .eq("function_id", functionId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort =
    existing && existing.length > 0 ? (existing[0].sort_order ?? 0) + 1 : 1;

  const { data, error } = await supabase
    .from("function_competencies")
    .insert({ function_id: functionId, title, body, sort_order: nextSort })
    .select("*")
    .single<FunctionCompetency>();
  if (error || !data) return { ok: false, message: "Couldn't add that." };
  revalidatePath(`/chart/function/${functionId}`);
  return { ok: true, item: data };
}

export async function renameFunctionCompetencyAction(
  id: string,
  newTitle: string
): Promise<ChartResult<FunctionCompetency>> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const title = newTitle.trim();
  if (!id || !title) return { ok: false, message: "Title can't be empty." };

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("function_competencies")
    .update({ title })
    .eq("id", id)
    .select("*")
    .single<FunctionCompetency>();
  if (error || !data) return { ok: false, message: "Couldn't rename." };
  revalidatePath(`/chart/function/${data.function_id}`);
  return { ok: true, item: data };
}

export async function deleteFunctionCompetencyAction(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: row } = await supabase
    .from("function_competencies")
    .select("function_id")
    .eq("id", id)
    .maybeSingle<Pick<FunctionCompetency, "function_id">>();
  if (!row) return { ok: false, message: "Not found." };

  const { error } = await supabase
    .from("function_competencies")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't delete." };
  revalidatePath(`/chart/function/${row.function_id}`);
  return { ok: true };
}
