import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { getChartFunctionDetail } from "@/lib/chart/service";
import type { RdDocument, RdUserOverrides } from "./generate";

// Persistent cache for the assembled Role Description.
//
// Two payloads per row:
//   document        — the raw generated RdDocument JSON from the
//                     last Sonnet call. Overwritten on regenerate.
//   user_overrides  — sparse RdUserOverrides jsonb. Written when
//                     an admin edits Position Summary or Why This
//                     Role Matters. Left ALONE on regenerate so
//                     user edits survive fresh generations.
//
// Staleness is checked automatically against the function's chart
// entities' updated_at. Admins can also force a regenerate via
// regenerateRoleDescriptionAction.

type Detail = NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>;

export type CachedRoleDescription = {
  document: RdDocument;
  overrides: RdUserOverrides | null;
  generatedAt: string;
  generatedBy: string | null;
};

export async function getCachedRoleDescription(
  functionId: string
): Promise<CachedRoleDescription | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("role_description_documents")
    .select("document, user_overrides, generated_at, generated_by")
    .eq("function_id", functionId)
    .maybeSingle<{
      document: RdDocument;
      user_overrides: RdUserOverrides | null;
      generated_at: string;
      generated_by: string | null;
    }>();
  if (!data) return null;
  return {
    document: data.document,
    overrides: data.user_overrides,
    generatedAt: data.generated_at,
    generatedBy: data.generated_by,
  };
}

// Upsert the generated document. Deliberately does NOT touch
// user_overrides — Postgres' upsert with a subset of columns
// preserves the existing user_overrides row content when the
// row already exists.
export async function saveRoleDescription(input: {
  functionId: string;
  generatedBy: string | null;
  document: RdDocument;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("role_description_documents")
    .upsert(
      {
        function_id: input.functionId,
        document: input.document,
        generated_at: new Date().toISOString(),
        generated_by: input.generatedBy,
      },
      { onConflict: "function_id" }
    );
}

// Write (or clear) a single user override field. Merges into the
// existing user_overrides jsonb so other fields survive.
export async function setUserOverride(input: {
  functionId: string;
  field: keyof RdUserOverrides;
  value: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("role_description_documents")
    .select("user_overrides")
    .eq("function_id", input.functionId)
    .maybeSingle<{ user_overrides: RdUserOverrides | null }>();

  const current = data?.user_overrides ?? {};
  const next: RdUserOverrides = { ...current };
  if (input.value === null || input.value.trim().length === 0) {
    delete next[input.field];
  } else {
    next[input.field] = input.value;
  }

  const { error } = await supabase
    .from("role_description_documents")
    .update({ user_overrides: Object.keys(next).length === 0 ? null : next })
    .eq("function_id", input.functionId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function deleteRoleDescriptionCache(
  functionId: string
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("role_description_documents")
    .delete()
    .eq("function_id", functionId);
}

// Cache is stale when any of the underlying chart entities that
// feed the RD prompt have been updated since the doc was generated.
// Checks in order of update likelihood — the function row and its
// R&R/outcomes/measures change most often; competencies and
// decision rights change less.
//
// Foundation-level changes (company purpose, values, differentiators)
// don't invalidate automatically — those change rarely and an admin
// can hit Regenerate if the RD needs to reflect a fresh set of
// values. Adding foundation to the staleness check would touch every
// function's cache on any foundation edit, which is heavier than
// the value it delivers.
export function isCacheStale(
  cached: CachedRoleDescription,
  detail: Detail
): boolean {
  const cachedAt = new Date(cached.generatedAt).getTime();
  const timestamps: string[] = [detail.fn.updated_at];
  for (const r of detail.roles) timestamps.push(r.updated_at);
  for (const o of detail.outcomes) {
    timestamps.push(o.updated_at);
    for (const m of o.measures) timestamps.push(m.updated_at);
  }
  for (const d of detail.decisionRights) timestamps.push(d.updated_at);
  for (const c of detail.competencies) timestamps.push(c.updated_at);
  for (const ts of timestamps) {
    if (new Date(ts).getTime() > cachedAt) return true;
  }
  return false;
}
