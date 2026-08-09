import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { getChartFunctionDetail } from "@/lib/chart/service";
import type { RdDocument } from "./generate";

// Persistent cache for the assembled Role Description.
//
// Storing generated JSON in role_description_documents lets the
// view page skip the multi-second Sonnet call on subsequent visits
// while nothing has changed. Staleness is checked automatically —
// if any of the function's chart entities (or the function row
// itself) has an updated_at newer than the cached generated_at,
// the next visit regenerates. Admins can also force a regenerate
// via regenerateRoleDescriptionAction.

type Detail = NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>;

export type CachedRoleDescription = {
  document: RdDocument;
  generatedAt: string;
  generatedBy: string | null;
};

export async function getCachedRoleDescription(
  functionId: string
): Promise<CachedRoleDescription | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("role_description_documents")
    .select("document, generated_at, generated_by")
    .eq("function_id", functionId)
    .maybeSingle<{
      document: RdDocument;
      generated_at: string;
      generated_by: string | null;
    }>();
  if (!data) return null;
  return {
    document: data.document,
    generatedAt: data.generated_at,
    generatedBy: data.generated_by,
  };
}

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
