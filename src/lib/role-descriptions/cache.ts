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
//                     an admin edits any prose section. Left ALONE
//                     on regenerate so user edits survive fresh
//                     generations.

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

// Apply a patch to the current user_overrides. Merges the patch on
// top of what's there — strings replace, arrays inside enrichments
// merge by matchTitle, structured sub-objects (strengths, quals)
// shallow-merge their fields. Values that are null or empty strings
// clear that field.
export async function patchUserOverrides(input: {
  functionId: string;
  patch: RdUserOverrides;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("role_description_documents")
    .select("user_overrides")
    .eq("function_id", input.functionId)
    .maybeSingle<{ user_overrides: RdUserOverrides | null }>();

  const current: RdUserOverrides = data?.user_overrides ?? {};
  const next = mergeOverrides(current, input.patch);
  const value = isEmptyOverrides(next) ? null : next;

  const { error } = await supabase
    .from("role_description_documents")
    .update({ user_overrides: value })
    .eq("function_id", input.functionId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// ---- Override merge helpers -------------------------------------

function mergeOverrides(
  current: RdUserOverrides,
  patch: RdUserOverrides
): RdUserOverrides {
  const next: RdUserOverrides = { ...current };

  if ("positionSummary" in patch) {
    setOrDelete(next, "positionSummary", patch.positionSummary);
  }
  if ("whyThisRoleMatters" in patch) {
    setOrDelete(next, "whyThisRoleMatters", patch.whyThisRoleMatters);
  }
  if (patch.outcomeEnrichments) {
    next.outcomeEnrichments = mergeEnrichmentArray(
      current.outcomeEnrichments ?? [],
      patch.outcomeEnrichments,
      ["whyItMatters", "valuesConnection"]
    );
    if (next.outcomeEnrichments.length === 0) delete next.outcomeEnrichments;
  }
  if (patch.responsibilityEnrichments) {
    next.responsibilityEnrichments = mergeEnrichmentArray(
      current.responsibilityEnrichments ?? [],
      patch.responsibilityEnrichments,
      ["strategicContext"]
    );
    if (next.responsibilityEnrichments.length === 0) {
      delete next.responsibilityEnrichments;
    }
  }
  if (patch.strengthsAndExpertise) {
    const s = { ...(current.strengthsAndExpertise ?? {}) };
    for (const key of ["technical", "strategic", "interpersonal"] as const) {
      if (key in patch.strengthsAndExpertise) {
        const v = patch.strengthsAndExpertise[key];
        if (!v || v.filter((x) => x.trim().length > 0).length === 0) {
          delete s[key];
        } else {
          s[key] = v.map((x) => x.trim()).filter(Boolean);
        }
      }
    }
    if ("accountability" in patch.strengthsAndExpertise) {
      const v = patch.strengthsAndExpertise.accountability;
      if (!v || v.trim().length === 0) delete s.accountability;
      else s.accountability = v;
    }
    if (Object.keys(s).length === 0) delete next.strengthsAndExpertise;
    else next.strengthsAndExpertise = s;
  }
  if (patch.qualifications) {
    const q = { ...(current.qualifications ?? {}) };
    for (const key of ["experience", "education", "certifications"] as const) {
      if (key in patch.qualifications) {
        const v = patch.qualifications[key];
        if (!v || v.trim().length === 0) delete q[key];
        else q[key] = v;
      }
    }
    if (Object.keys(q).length === 0) delete next.qualifications;
    else next.qualifications = q;
  }

  return next;
}

function setOrDelete<K extends "positionSummary" | "whyThisRoleMatters">(
  target: RdUserOverrides,
  key: K,
  value: string | undefined
): void {
  if (!value || value.trim().length === 0) {
    delete target[key];
  } else {
    target[key] = value;
  }
}

// Merge an array of enrichment overrides keyed by matchTitle. For
// each patch entry: locate the current entry (if any), apply the
// patch's non-nullish fields, then discard the entry entirely if
// all its fields end up empty.
function mergeEnrichmentArray<T extends { matchTitle: string }>(
  currentArr: T[],
  patchArr: T[],
  fields: Array<Exclude<keyof T, "matchTitle">>
): T[] {
  const byTitle = new Map<string, T>();
  for (const entry of currentArr) {
    if (entry.matchTitle) byTitle.set(entry.matchTitle, { ...entry });
  }
  for (const patch of patchArr) {
    if (!patch.matchTitle) continue;
    const existing =
      byTitle.get(patch.matchTitle) ??
      ({ matchTitle: patch.matchTitle } as T);
    const merged = { ...existing } as T;
    for (const key of fields) {
      const v = patch[key];
      if (typeof v === "string") {
        if (v.trim().length === 0) {
          delete (merged as Record<string, unknown>)[key as string];
        } else {
          (merged as Record<string, unknown>)[key as string] = v;
        }
      }
    }
    // Drop the entry entirely when only matchTitle remains.
    const hasContent = fields.some(
      (k) => typeof merged[k] === "string" && (merged[k] as string).trim().length > 0
    );
    if (hasContent) {
      byTitle.set(patch.matchTitle, merged);
    } else {
      byTitle.delete(patch.matchTitle);
    }
  }
  return Array.from(byTitle.values());
}

function isEmptyOverrides(o: RdUserOverrides): boolean {
  return Object.keys(o).length === 0;
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
// Foundation-level changes don't auto-invalidate — admins hit
// Regenerate if the RD needs to reflect a fresh set of values.
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
