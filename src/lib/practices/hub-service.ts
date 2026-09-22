import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { PRACTICES } from "./registry";

// What the Agent Hub reads.
//
// Deliberately NOT the merge in resolve.ts. That one answers "what
// should this user see", so it drops archived agents and hides rows
// whose slug matches no registry entry. The Hub has to show exactly
// what is in the tables, archived and orphaned included, because it
// is the screen for fixing them. A surface that hid the rows needing
// attention would be the one place they could never be reached.

export type HubCategory = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  archived: boolean;
  // Archived agents count. A category holding only archived agents
  // is not empty, and archiving it would strand them somewhere no
  // picker and no editor lists.
  agentCount: number;
};

export type HubAgent = {
  id: string;
  slug: string;
  categoryId: string;
  title: string;
  description: string;
  sortOrder: number;
  allowedRoles: string[];
  feature: string | null;
  accessPredicates: string[];
  companyAllowlist: string[];
  archived: boolean;
  // False when no registry entry matches the slug, which today means
  // the agent cannot run: its prompt has nowhere to come from.
  // Database-defined agents are phase 3. Until then the Hub says so
  // rather than offering an editor for something that opens onto
  // nothing.
  hasRegistryEntry: boolean;
};

export async function listHubCategories(): Promise<HubCategory[]> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const [{ data: cats }, { data: agents }] = await Promise.all([
    db
      .from("agent_categories")
      .select("id, name, slug, sort_order, archived")
      .order("sort_order"),
    db.from("agents").select("category_id"),
  ]);
  const counts = new Map<string, number>();
  for (const a of (agents ?? []) as Array<{ category_id: string }>) {
    counts.set(a.category_id, (counts.get(a.category_id) ?? 0) + 1);
  }
  return (
    (cats ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
      sort_order: number;
      archived: boolean;
    }>
  ).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    sortOrder: c.sort_order,
    archived: c.archived,
    agentCount: counts.get(c.id) ?? 0,
  }));
}

export async function listHubAgents(): Promise<HubAgent[]> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await db
    .from("agents")
    .select(
      "id, slug, category_id, title, description, sort_order, allowed_roles, " +
        "feature, access_predicates, company_allowlist, archived"
    )
    .order("sort_order");
  const registrySlugs = new Set(PRACTICES.map((p) => p.id));
  // `as unknown as` because the select list is built by
  // concatenation, which the client's literal-type inference cannot
  // read — same reason and same shape as resolve.ts.
  return (
    (data ?? []) as unknown as Array<{
      id: string;
      slug: string;
      category_id: string;
      title: string;
      description: string;
      sort_order: number;
      allowed_roles: string[] | null;
      feature: string | null;
      access_predicates: string[] | null;
      company_allowlist: string[] | null;
      archived: boolean;
    }>
  ).map((a) => ({
    id: a.id,
    slug: a.slug,
    categoryId: a.category_id,
    title: a.title,
    description: a.description,
    sortOrder: a.sort_order,
    allowedRoles: a.allowed_roles ?? [],
    feature: a.feature,
    accessPredicates: a.access_predicates ?? [],
    companyAllowlist: a.company_allowlist ?? [],
    archived: a.archived,
    hasRegistryEntry: registrySlugs.has(a.slug),
  }));
}

export type HubCompany = { id: string; name: string };

// For the allowlist picker: every company on the instance, because a
// system admin allowlisting an agent is working across tenants by
// definition.
export async function listHubCompanies(): Promise<HubCompany[]> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await db.from("companies").select("id, name").order("name");
  return ((data ?? []) as Array<{ id: string; name: string }>).map((c) => ({
    id: c.id,
    name: c.name,
  }));
}
