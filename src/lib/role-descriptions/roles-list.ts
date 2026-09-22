import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { parseRoleDescription, type RoleDescriptionDoc } from "./parse-document";

// Every role description a company has, newest version per role.
//
// Roles, not versions: the list answers "what have we written" and
// a role with four versions is one row on it. The version number
// and date come from the newest one, which is what a reader means
// by "the role description".
//
// RLS scopes this to the caller's company; the company id is passed
// because the page already resolved the effective scope and a
// second resolution here could disagree with it.

export type RoleListRow = {
  roleId: string;
  title: string;
  functionId: string | null;
  supportsFunctions: string[];
  versionNumber: number;
  updatedAt: string;
  authorName: string | null;
  // Parsed, because the list shows a line from the document and a
  // row whose body will not parse should say so rather than render
  // a blank where a sentence belongs.
  doc: RoleDescriptionDoc | null;
};

export async function listRoleDescriptions(
  companyId: string
): Promise<RoleListRow[]> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: roleRows } = await db
    .from("role_descriptions")
    .select("id, title, function_id, supports_functions")
    .eq("company_id", companyId)
    .order("title");
  const roles = (roleRows ?? []) as Array<{
    id: string;
    title: string;
    function_id: string | null;
    supports_functions: string[] | null;
  }>;
  if (roles.length === 0) return [];

  // Every version for these roles, newest first, reduced in memory.
  // A per-role query would be one round trip per row on a page whose
  // whole job is to list rows.
  const { data: versionRows } = await db
    .from("role_description_versions")
    .select(
      "role_id, version_number, body_json, published_at, published_by, profiles:published_by (full_name)"
    )
    .in(
      "role_id",
      roles.map((r) => r.id)
    )
    .order("version_number", { ascending: false });
  const versions = (versionRows ?? []) as Array<{
    role_id: string;
    version_number: number;
    body_json: unknown;
    published_at: string;
    profiles: { full_name: string } | Array<{ full_name: string }> | null;
  }>;

  const newest = new Map<string, (typeof versions)[number]>();
  for (const v of versions) {
    if (!newest.has(v.role_id)) newest.set(v.role_id, v);
  }

  const out: RoleListRow[] = [];
  for (const role of roles) {
    const v = newest.get(role.id);
    // A role row with no version is a save that failed halfway. It
    // is not a role description yet, so it is not on the list of
    // them.
    if (!v) continue;
    out.push({
      roleId: role.id,
      title: role.title,
      functionId: role.function_id,
      supportsFunctions: role.supports_functions ?? [],
      versionNumber: v.version_number,
      updatedAt: v.published_at,
      authorName: firstName(v.profiles),
      doc:
        v.body_json === null || v.body_json === undefined
          ? null
          : parseRoleDescription(JSON.stringify(v.body_json)),
    });
  }
  // Newest work first. Alphabetical is what the roles query gives
  // and it is the wrong answer for a page somebody opens to find
  // what they just wrote.
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

// PostgREST returns an embedded one-to-one as an object or a
// single-element array depending on the relationship it inferred.
function firstName(
  raw: { full_name: string } | Array<{ full_name: string }> | null
): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0]?.full_name ?? null;
  return raw.full_name;
}
