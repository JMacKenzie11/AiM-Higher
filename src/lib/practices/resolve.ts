import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { PRACTICES, type Practice } from "./registry";
import { PRACTICE_CATEGORIES } from "./categories";

// Where a code-defined agent meets its database row.
//
// ---- THE SPLIT, AND WHY IT IS WHERE IT IS ----------------------
//
// The database wins on identity and access: title, description,
// category, ordering, allowed roles, feature gate, access
// predicates, company allowlist. Those are the things a system
// admin can change from a screen without a deploy, and the whole
// point of the Hub.
//
// The registry wins on everything else: the prompt file, tools,
// output cards, base prompt mode, chips, maxTokens. Those resolve
// to server functions, React components and files on disk, so a row
// cannot hold them. A database that claimed to would be describing
// capabilities that do not exist.
//
// ---- A ROW WITH NO REGISTRY ENTRY IS IGNORED -------------------
//
// Phase 3 adds database-defined agents. Until the runtime can build
// one — its prompt has nowhere to come from today — a row whose
// slug matches no registry id is dropped from the merge and logged
// ONCE per process rather than thrown. A half-defined agent that
// reaches a picker is a conversation that opens onto nothing.
//
// ---- THE FALLBACK ----------------------------------------------
//
// If the query fails, or the tables are empty, every reader gets
// the pure registry. The picker must never render blank because a
// database is having a bad minute, and before this migration the
// registry WAS the product, so falling back to it is falling back
// to a state that shipped.

export type ResolvedAgent = Practice & {
  // Present when a database row supplied the identity. Null when
  // this is the bare registry entry, which is the fallback shape.
  agentRowId: string | null;
  sortOrder: number;
  categorySortOrder: number;
  archived: boolean;
  companyAllowlist: readonly string[];
};

type AgentRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  sort_order: number;
  allowed_roles: string[] | null;
  feature: string | null;
  access_predicates: string[] | null;
  company_allowlist: string[] | null;
  archived: boolean;
  agent_categories: { name: string; sort_order: number } | null;
};

let warnedSlugs: Set<string> | null = null;

function warnOnce(slug: string) {
  warnedSlugs ??= new Set();
  if (warnedSlugs.has(slug)) return;
  warnedSlugs.add(slug);
  console.warn(
    `agents: row "${slug}" matches no registry agent and was ignored. ` +
      "Database-defined agents are phase 3."
  );
}

// Read once per request. Every gate, the picker, and the runtime
// ask; React's cache means they share one query rather than each
// paying for it.
const loadAgentRows = cache(async function loadAgentRows(): Promise<
  AgentRow[] | null
> {
  try {
    const db = await createSupabaseServerClient(getCurrentInstanceConfig());
    const { data, error } = await db
      .from("agents")
      .select(
        "id, slug, title, description, sort_order, allowed_roles, feature, " +
          "access_predicates, company_allowlist, archived, " +
          "agent_categories ( name, sort_order )"
      );
    if (error) return null;
    return (data ?? []) as unknown as AgentRow[];
  } catch {
    // The tables not existing yet is this path too, which is what
    // makes the migration safe to land ahead of a deploy.
    return null;
  }
});

function categoryOrder(name: string): number {
  const i = PRACTICE_CATEGORIES.indexOf(name as (typeof PRACTICE_CATEGORIES)[number]);
  return i === -1 ? PRACTICE_CATEGORIES.length : i;
}

// The registry alone, in array order, as if no database existed.
function fromRegistryOnly(): ResolvedAgent[] {
  return PRACTICES.map((p, i) => ({
    ...p,
    agentRowId: null,
    sortOrder: i,
    categorySortOrder: categoryOrder(p.category),
    archived: false,
    companyAllowlist: [],
  }));
}

export const listAgents = cache(async function listAgents(): Promise<
  ResolvedAgent[]
> {
  const rows = await loadAgentRows();
  if (rows === null || rows.length === 0) return fromRegistryOnly();

  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  for (const row of rows) {
    if (!PRACTICES.some((p) => p.id === row.slug)) warnOnce(row.slug);
  }

  const merged: ResolvedAgent[] = [];
  for (const [i, practice] of PRACTICES.entries()) {
    const row = bySlug.get(practice.id);
    if (!row) {
      // In the registry, not in the database. Seeded state covers
      // all five, so this is a code-defined agent added since the
      // seed — it shows, unedited, rather than disappearing.
      merged.push({
        ...practice,
        agentRowId: null,
        sortOrder: i,
        categorySortOrder: categoryOrder(practice.category),
        archived: false,
        companyAllowlist: [],
      });
      continue;
    }
    merged.push({
      ...practice,
      // Database wins: identity.
      title: row.title,
      description: row.description,
      category: (row.agent_categories?.name ??
        practice.category) as Practice["category"],
      // Database wins: access. An empty allowed_roles means "every
      // role", matching a registry entry that declares none — so
      // undefined and [] have to stay the same thing.
      allowedRoles:
        row.allowed_roles && row.allowed_roles.length > 0
          ? (row.allowed_roles as Practice["allowedRoles"])
          : undefined,
      feature: (row.feature ?? undefined) as Practice["feature"],
      alsoFunctionLeads:
        (row.access_predicates ?? []).includes("function_lead") || undefined,
      agentRowId: row.id,
      sortOrder: row.sort_order,
      categorySortOrder:
        row.agent_categories?.sort_order ?? categoryOrder(practice.category),
      archived: row.archived,
      companyAllowlist: row.company_allowlist ?? [],
    });
  }

  // Archived agents are dropped here, so no caller has to remember
  // to filter them. The Hub reads rows directly and sees its own.
  return merged
    .filter((a) => !a.archived)
    .sort(
      (a, b) =>
        a.categorySortOrder - b.categorySortOrder ||
        a.sortOrder - b.sortOrder ||
        a.title.localeCompare(b.title)
    );
});

// The merge-aware findPractice. Same contract as the registry's —
// null for an unknown id — so every call site reads the same, and
// the same as before for anything the database does not cover.
export const resolveAgent = cache(async function resolveAgent(
  id: string | null | undefined
): Promise<ResolvedAgent | null> {
  if (!id) return null;
  // NOT listAgents(): that drops archived agents, and a
  // conversation already attached to one must keep working. The
  // Hub's archive hides an agent from pickers; it does not end
  // conversations.
  const all = await listAgentsIncludingArchived();
  return all.find((a) => a.id === id) ?? null;
});

// Every agent the merge knows, archived included. For the runtime
// and for the Hub; not for pickers.
export const listAgentsIncludingArchived = cache(
  async function listAgentsIncludingArchived(): Promise<ResolvedAgent[]> {
    const rows = await loadAgentRows();
    if (rows === null || rows.length === 0) return fromRegistryOnly();
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    return PRACTICES.map((practice, i) => {
      const row = bySlug.get(practice.id);
      if (!row) {
        return {
          ...practice,
          agentRowId: null,
          sortOrder: i,
          categorySortOrder: categoryOrder(practice.category),
          archived: false,
          companyAllowlist: [] as readonly string[],
        };
      }
      return {
        ...practice,
        title: row.title,
        description: row.description,
        category: (row.agent_categories?.name ??
          practice.category) as Practice["category"],
        allowedRoles:
          row.allowed_roles && row.allowed_roles.length > 0
            ? (row.allowed_roles as Practice["allowedRoles"])
            : undefined,
        feature: (row.feature ?? undefined) as Practice["feature"],
        alsoFunctionLeads:
          (row.access_predicates ?? []).includes("function_lead") || undefined,
        agentRowId: row.id,
        sortOrder: row.sort_order,
        categorySortOrder:
          row.agent_categories?.sort_order ?? categoryOrder(practice.category),
        archived: row.archived,
        companyAllowlist: (row.company_allowlist ?? []) as readonly string[],
      };
    });
  }
);

// The category names and their order, for a picker that groups.
// Falls back to the code constant for the same reasons as above.
export const listAgentCategories = cache(
  async function listAgentCategories(): Promise<string[]> {
    try {
      const db = await createSupabaseServerClient(getCurrentInstanceConfig());
      const { data, error } = await db
        .from("agent_categories")
        .select("name, sort_order, archived")
        .eq("archived", false)
        .order("sort_order");
      if (error || !data || data.length === 0) {
        return [...PRACTICE_CATEGORIES];
      }
      return (data as Array<{ name: string }>).map((c) => c.name);
    } catch {
      return [...PRACTICE_CATEGORIES];
    }
  }
);

// Agent id to display title, for reports that render many rows.
// Archived included: a report covering last quarter should still
// name the agent those conversations used.
export const agentTitlesById = cache(async function agentTitlesById(): Promise<
  Map<string, string>
> {
  const all = await listAgentsIncludingArchived();
  return new Map(all.map((a) => [a.id, a.title]));
});
