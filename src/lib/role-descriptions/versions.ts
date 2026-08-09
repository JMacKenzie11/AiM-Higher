import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RdDocument, RdUserOverrides } from "./generate";

// Read/write service for role_description_versions — the frozen
// snapshots of the RD published at a moment in time. Writes are
// insert-only (published_at defaults now(), version_number
// computed as max+1). No update path — versions never change
// once published.

export type PublishedVersion = {
  id: string;
  functionId: string;
  versionNumber: number;
  snapshotDocument: RdDocument;
  snapshotOverrides: RdUserOverrides | null;
  notes: string | null;
  publishedBy: string | null;
  publishedByName: string | null;
  publishedAt: string;
};

export async function listPublishedVersions(
  functionId: string
): Promise<PublishedVersion[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("role_description_versions")
    .select(
      "id, function_id, version_number, snapshot_document, snapshot_overrides, notes, published_by, published_at, profiles:published_by (full_name)"
    )
    .eq("function_id", functionId)
    .order("version_number", { ascending: false });
  return ((data ?? []) as Array<{
    id: string;
    function_id: string;
    version_number: number;
    snapshot_document: RdDocument;
    snapshot_overrides: RdUserOverrides | null;
    notes: string | null;
    published_by: string | null;
    published_at: string;
    profiles: { full_name: string } | Array<{ full_name: string }> | null;
  }>).map((row) => ({
    id: row.id,
    functionId: row.function_id,
    versionNumber: row.version_number,
    snapshotDocument: row.snapshot_document,
    snapshotOverrides: row.snapshot_overrides,
    notes: row.notes,
    publishedBy: row.published_by,
    publishedByName: firstProfileName(row.profiles),
    publishedAt: row.published_at,
  }));
}

export async function getPublishedVersion(
  functionId: string,
  versionNumber: number
): Promise<PublishedVersion | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("role_description_versions")
    .select(
      "id, function_id, version_number, snapshot_document, snapshot_overrides, notes, published_by, published_at, profiles:published_by (full_name)"
    )
    .eq("function_id", functionId)
    .eq("version_number", versionNumber)
    .maybeSingle<{
      id: string;
      function_id: string;
      version_number: number;
      snapshot_document: RdDocument;
      snapshot_overrides: RdUserOverrides | null;
      notes: string | null;
      published_by: string | null;
      published_at: string;
      profiles: { full_name: string } | Array<{ full_name: string }> | null;
    }>();
  if (!data) return null;
  return {
    id: data.id,
    functionId: data.function_id,
    versionNumber: data.version_number,
    snapshotDocument: data.snapshot_document,
    snapshotOverrides: data.snapshot_overrides,
    notes: data.notes,
    publishedBy: data.published_by,
    publishedByName: firstProfileName(data.profiles),
    publishedAt: data.published_at,
  };
}

// Supabase's postgrest-js returns embedded relationships as an
// array by default, but the "?..." → "?...!inner" arrow syntax
// (and single-fk joins in some environments) can return an
// object. Normalize both shapes to a single name string.
function firstProfileName(
  raw:
    | { full_name: string }
    | Array<{ full_name: string }>
    | null
    | undefined
): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0]?.full_name ?? null;
  return raw.full_name ?? null;
}

export async function publishVersion(input: {
  functionId: string;
  publishedBy: string | null;
  document: RdDocument;
  overrides: RdUserOverrides | null;
  notes: string | null;
}): Promise<{ ok: true; versionNumber: number } | { ok: false; message: string }> {
  const supabase = await createSupabaseServerClient();

  // Compute next version_number = max existing + 1. Not atomic
  // strictly speaking — two admins publishing at the same instant
  // could race — but the unique index on (function_id, version_number)
  // will surface the collision as a DB error, and the caller can
  // retry.
  const { data: last } = await supabase
    .from("role_description_versions")
    .select("version_number")
    .eq("function_id", input.functionId)
    .order("version_number", { ascending: false })
    .limit(1);
  const nextNumber =
    last && last.length > 0 ? (last[0].version_number ?? 0) + 1 : 1;

  const { error } = await supabase.from("role_description_versions").insert({
    function_id: input.functionId,
    version_number: nextNumber,
    snapshot_document: input.document,
    snapshot_overrides: input.overrides,
    notes: input.notes,
    published_by: input.publishedBy,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, versionNumber: nextNumber };
}

export async function deletePublishedVersion(
  functionId: string,
  versionNumber: number
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("role_description_versions")
    .delete()
    .eq("function_id", functionId)
    .eq("version_number", versionNumber);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
