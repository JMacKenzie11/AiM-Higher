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
// ---- A ROW WITH NO REGISTRY ENTRY (phase 3) --------------------
//
// It is a DATABASE-DEFINED AGENT, and whether it resolves depends on
// one thing: does it have a live version?
//
//   live_version_id set   a real agent. Appended to the merged set,
//                         with its config resolved entirely from
//                         that version.
//   live_version_id null  Hub only. Never reaches a picker or a
//                         launch path, because there is nothing to
//                         run: an unpublished agent has no prompt
//                         anybody has approved.
//
// Phase 1 dropped these rows and logged a warning saying phase 3
// would handle them. It does, so the warning is gone.
//
// ---- THE PIN IS THE FALLBACK -----------------------------------
//
// A registry-backed agent can always fall back to code. A
// database-only one cannot — there is no file to read. What makes
// that safe is that version rows are IMMUTABLE and a conversation
// reads the version pinned to it, so unpublishing or archiving a
// database-defined agent takes it out of the pickers without
// touching a single conversation in flight. Nothing in this phase
// may weaken that.
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
  // True when no registry entry backs this agent: it exists only as
  // a row plus its versions. Callers that would otherwise reach for
  // a file on disk check this first.
  isDatabaseDefined: boolean;
  // The version new conversations are stamped from. Null means "runs
  // from the registry", which is impossible for a database-defined
  // agent — such an agent is not in the merged set at all without
  // one.
  liveVersionId: string | null;
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
  archived: boolean;
  live_version_id: string | null;
  agent_categories: { name: string; sort_order: number } | null;
};

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
          "access_predicates, archived, live_version_id, " +
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

// A row with no registry entry, as a ResolvedAgent.
//
// The Practice-shaped config fields are PLACEHOLDERS and are never
// read for one of these. Everything that actually runs — prompt,
// base mode, chips, tools, cards, model, token ceiling — comes from
// the pinned version through resolveRuntimeConfig, which is the only
// thing that can read agent_versions anyway (system_admin-only, so
// the merge runs on a client that cannot see it).
//
// promptFile is empty for the same reason: there is no file. Anything
// tempted to read it must check isDatabaseDefined first.
function fromRowOnly(row: AgentRow): ResolvedAgent {
  return {
    id: row.slug,
    title: row.title,
    description: row.description,
    category: (row.agent_categories?.name ?? "People") as Practice["category"],
    promptFile: "",
    basePromptMode: "full_coach",
    skipSetup: false,
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
      row.agent_categories?.sort_order ?? PRACTICE_CATEGORIES.length,
    archived: row.archived,
    isDatabaseDefined: true,
    liveVersionId: row.live_version_id,
  };
}

// Database-defined agents: rows with no registry entry.
//
// `requireLive` is the difference between the two callers, and it
// matters more than it looks:
//
//   true   for PICKERS. Without a live version there is no approved
//          prompt, so the agent is not offerable.
//
//   false  for the runtime and the Hub. An UNPUBLISHED agent has no
//          live version and may still have conversations pinned to
//          its old versions — that is precisely what unpublish is
//          for. Filtering those out here would strip the agent's
//          name off every one of them and resolveAgent would answer
//          null mid-conversation.
function databaseDefined(
  rows: AgentRow[],
  { requireLive }: { requireLive: boolean }
): ResolvedAgent[] {
  return rows
    .filter((r) => !PRACTICES.some((p) => p.id === r.slug))
    .filter((r) => (requireLive ? r.live_version_id !== null : true))
    .map(fromRowOnly);
}

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
    isDatabaseDefined: false,
    liveVersionId: null,
  }));
}

export const listAgents = cache(async function listAgents(): Promise<
  ResolvedAgent[]
> {
  const rows = await loadAgentRows();
  if (rows === null || rows.length === 0) return fromRegistryOnly();

  const bySlug = new Map(rows.map((r) => [r.slug, r]));
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
        isDatabaseDefined: false,
        liveVersionId: null,
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
      isDatabaseDefined: false,
      liveVersionId: row.live_version_id,
    });
  }

  merged.push(...databaseDefined(rows, { requireLive: true }));

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
    const fromRegistry = PRACTICES.map((practice, i) => {
      const row = bySlug.get(practice.id);
      if (!row) {
        return {
          ...practice,
          agentRowId: null,
          sortOrder: i,
          categorySortOrder: categoryOrder(practice.category),
          archived: false,
          isDatabaseDefined: false,
          liveVersionId: null,
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
        isDatabaseDefined: false,
        liveVersionId: row.live_version_id,
      };
    });
    // Archived database-defined agents are included here and only
    // here: a conversation attached to one must keep working and
    // keep its name, exactly as for an archived registry agent.
    return [...fromRegistry, ...databaseDefined(rows, { requireLive: false })];
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
