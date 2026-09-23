import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listActiveInstances, lookupInstance } from "@/lib/instances/registry";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { isPrimaryInstance } from "@/lib/instances/primary";
import { isServable } from "@/lib/instances/types";
import type { DistributionStep } from "./distribution-types";

// Pushing an agent from the main instance to chosen instances.
//
// ---- WHY THIS FOLLOWS sync-content, NOT THE MIGRATION RUNNER ----
//
// The migration runner walks the fleet applying SCHEMA in lockstep,
// and a failure part way leaves a fleet in mixed states that must be
// resolved before deploying. This is content: instance three failing
// has no bearing on one and two, whose copies are complete and
// correct. sync-content already drew that line — "ONE WAY, PRIMARY
// OUTWARD, FULL MIRROR" — and this follows it.
//
// ---- THE ONE PLACE THAT CROSSES INSTANCES -----------------------
//
// This module is the second entry in the allowlist that
// isolation.test.ts enforces, and it earns it on three counts: it
// runs from an explicit admin action, never while serving a client;
// it only ever writes OUTWARD; and nothing it reads from another
// instance reaches a response. The dry run reads three tables on the
// target — agents, agent_categories, company_features — to build a
// plan, and the plan names counts and slugs, never tenant content.
//
// ---- ORDER IS THE SAFETY PROPERTY -------------------------------
//
//   1. refuse if the target lacks the agent tables   (before any write)
//   2. refuse if the slug is local there, or managed from elsewhere
//   3. upsert the agent row by slug
//   4. carry the category by slug, creating it if absent
//   5. insert the version through the one door (0230)
//   6. move the live pointer LAST, once the version is confirmed
//
// Step 6 last is what makes a half-landed push safe. A target that
// fails at 5 has an agent row and no live pointer, which is exactly
// the "Hub only" state phase 3 already defines — invisible to
// everyone but a system admin — rather than a broken agent. A retry
// completes it, and every step is an upsert, so nothing doubles.

export type DistributionSource = {
  slug: string;
  title: string;
  description: string;
  categorySlug: string;
  categoryName: string;
  allowedRoles: string[];
  feature: string | null;
  accessPredicates: string[];
  versionNumber: number;
  prompt: string;
  chips: unknown;
  basePromptMode: string;
  skipSetup: boolean;
  firstTurn: string | null;
  scriptedOpener: string | null;
  tools: string[];
  maxTokens: number | null;
  model: string | null;
  publishNotes: string;
};

export type Target = { subdomain: string; displayName: string };

// Every instance a push may target: active, servable, and not this
// one. The main instance is the author, never a target.
//
// ---- AND NOTHING AT ALL IF WE ARE NOT AN INSTANCE ---------------
//
// Caught by the first screenshot of the panel, which offered to push
// to "AiMS Higher (@)" — production — from a local dev server.
//
// The exclusion below removes the CURRENT instance, and locally the
// current instance is the dev clone, which has no registry row at
// all. So nothing matched, nothing was excluded, and every real
// instance was on offer. The apply gate would have refused the
// write, but the panel should never have listed them: a screen that
// invites you to push into production from a laptop is wrong even
// when the button is disabled.
//
// So distribution is unavailable unless this deployment IS one of
// the registered instances, proven by the database it is pointed at
// rather than by a name. A subdomain is a label and labels can
// agree by accident; the supabase URL is the thing that decides
// whose data gets written.
export async function distributionTargets(): Promise<Target[]> {
  // ONLY THE AUTHORING INSTANCE PUSHES. Without this, a client
  // instance that is in the registry sees HQ in its own target list
  // and is one click from pushing its agents into production. The
  // actions refuse it and 0231 refuses the local writes that would
  // produce something worth pushing, but a list that names HQ as a
  // destination should never be drawn at all.
  if (!(await isPrimaryInstance())) return [];

  const here = await getCurrentInstanceConfig();
  const rows = await listActiveInstances();

  let isRegistered = false;
  for (const row of rows) {
    const resolved = await lookupInstance(row.subdomain);
    if (resolved && resolved.supabaseUrl === here.supabaseUrl) {
      isRegistered = true;
      break;
    }
  }
  if (!isRegistered) return [];

  const seen = new Set<string>();
  const out: Target[] = [];
  for (const row of rows) {
    if (row.subdomain === here.subdomain) continue;
    // And by database, not only by name: the check above proved one
    // of these rows IS us, and this is what keeps us off the list.
    const resolved = await lookupInstance(row.subdomain);
    if (resolved && resolved.supabaseUrl === here.supabaseUrl) continue;
    // Dedupe by env_prefix, the rule for-each.ts applies for the same
    // reason: two registry rows can name one database, and pushing to
    // it twice is not harmless.
    if (seen.has(row.envPrefix)) continue;
    seen.add(row.envPrefix);
    out.push({ subdomain: row.subdomain, displayName: row.displayName });
  }
  return out;
}

async function clientFor(subdomain: string): Promise<SupabaseClient | null> {
  const instance = await lookupInstance(subdomain);
  if (!instance || !isServable(instance.status)) return null;
  return createSupabaseAdminClient(instance);
}

// Does this target have the phase 2 tables? Checked BEFORE any write:
// an instance behind on migrations would otherwise fail part way
// through and leave an agent row with no version.
async function hasAgentTables(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from("agent_versions").select("id").limit(1);
  return !error;
}

export type TargetState = {
  agentId: string | null;
  managedFrom: string | null;
  liveVersionNumber: number | null;
  // Evidence of local authorship, for the adoption rule below.
  versionCount: number;
  hasDraft: boolean;
};

async function readTargetState(
  db: SupabaseClient,
  slug: string
): Promise<TargetState> {
  const { data } = await db
    .from("agents")
    .select("id, managed_from, live_version_id, draft_version_id")
    .eq("slug", slug)
    .maybeSingle<{
      id: string;
      managed_from: string | null;
      live_version_id: string | null;
      draft_version_id: string | null;
    }>();
  if (!data) {
    return {
      agentId: null,
      managedFrom: null,
      liveVersionNumber: null,
      versionCount: 0,
      hasDraft: false,
    };
  }
  let liveVersionNumber: number | null = null;
  if (data.live_version_id) {
    const { data: v } = await db
      .from("agent_versions")
      .select("version_number")
      .eq("id", data.live_version_id)
      .maybeSingle<{ version_number: number }>();
    liveVersionNumber = v?.version_number ?? null;
  }
  // A count, not a fetch: the question is whether anything was ever
  // published here, and the prompts themselves are none of our
  // business. head:true sends no rows back.
  const { count } = await db
    .from("agent_versions")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", data.id);
  return {
    agentId: data.id,
    managedFrom: data.managed_from,
    liveVersionNumber,
    versionCount: count ?? 0,
    hasDraft: data.draft_version_id !== null,
  };
}

// Is this target's copy an untouched seed rather than somebody's work?
//
// ---- WHY THIS QUESTION EXISTS ----------------------------------
//
// 0226 seeds five agents and migrations run fleet-wide, so every
// instance has five rows with managed_from null. The refusal below
// reads that as "authored here" and blocks the first push to any
// instance, for the five agents most likely to be pushed. It is not
// a one-off on one instance either: the next instance provisioned
// arrives in the same state.
//
// ---- WHAT COUNTS AS EVIDENCE ------------------------------------
//
// Not the timestamps, and not the slug. Publishing is the only way
// an agent's config reaches anybody on that instance, so an agent
// with no versions, no live pointer and no draft has never been
// anything a user there could run. Adopting it takes nothing away
// from anyone.
//
// Anything with a single version still refuses. A version is
// somebody's published work, and a push would replace what their
// users are running with ours.
// What a plan says when it is about to adopt a seeded copy.
//
// Its own function so the sentence has one home and can be read
// without running a push against a live instance, which is how the
// last version of it stayed wrong after 0231 made it untrue.
export function seedAdoptionWarning(
  slug: string,
  versionNumber: number
): string {
  return (
    `This instance already has "${slug}" from the original install, ` +
    "running the wording built into the code. Pushing replaces that " +
    `with version ${versionNumber}, and it follows this instance from ` +
    "then on."
  );
}

export function isUntouchedSeed(state: TargetState): boolean {
  return (
    state.versionCount === 0 &&
    state.liveVersionNumber === null &&
    !state.hasDraft
  );
}

// A feature gate naming a feature no company holds makes an agent
// live and invisible — a state nobody can debug from the Hub, and
// one worth a sentence before the push rather than a mystery after.
async function featureWarning(
  db: SupabaseClient,
  feature: string | null
): Promise<string | null> {
  if (!feature) return null;
  const { count, error } = await db
    .from("company_features")
    .select("company_id", { count: "exact", head: true })
    .eq("feature", feature);
  if (error) return null;
  if ((count ?? 0) > 0) return null;
  return (
    `Live on this instance but visible to no company until the ` +
    `"${feature}" feature is enabled for at least one of them.`
  );
}

// One target. `apply: false` is the dry run — the same walk, the same
// refusals, the same order, and no writes.
export async function distributeToTarget(
  source: DistributionSource,
  target: Target,
  actorProfileId: string,
  sourceSubdomain: string,
  apply: boolean
): Promise<DistributionStep> {
  const base = {
    subdomain: target.subdomain,
    displayName: target.displayName,
    fromVersion: null as number | null,
    toVersion: source.versionNumber as number | null,
    warnings: [] as string[],
  };

  const db = await clientFor(target.subdomain);
  if (!db) {
    return {
      ...base,
      outcome: "failed",
      toVersion: null,
      detail:
        "Could not reach this instance: it is not servable, or its " +
        "environment variables are not set in this deployment.",
    };
  }

  if (!(await hasAgentTables(db))) {
    return {
      ...base,
      outcome: "refused",
      toVersion: null,
      detail:
        "This instance has not had the Agent Hub migrations applied. " +
        "Run the fleet migration first.",
    };
  }

  const state = await readTargetState(db, source.slug);
  base.fromVersion = state.liveVersionNumber;

  if (state.agentId && state.managedFrom === null) {
    if (isUntouchedSeed(state)) {
      // Adopted, and said out loud in the plan, so the dry run is
      // where this is noticed rather than afterwards.
      //
      // WHAT THIS SENTENCE USED TO SAY, and why it was wrong: that
      // "local admins stop being able to edit it". Written for phase
      // 4b, when a receiving instance's system admin could still
      // edit a seeded agent. 0231 removed that from every instance
      // that is not the authoring one, so the warning was promising
      // a change that had already happened, in a term that read as
      // if some other class of admin existed. What actually changes
      // is what that instance RUNS, which is the thing somebody
      // reading a plan needs to weigh.
      base.warnings.push(
        seedAdoptionWarning(source.slug, source.versionNumber)
      );
    } else {
      return {
        ...base,
        outcome: "refused",
        detail:
          `An agent with the id "${source.slug}" already exists here, was ` +
          "created here, and has published versions. Pushing would replace " +
          "what its users are running, so it is refused. Rename one of them.",
      };
    }
  }
  if (
    state.agentId &&
    state.managedFrom !== null &&
    state.managedFrom !== sourceSubdomain
  ) {
    return {
      ...base,
      outcome: "refused",
      detail: `"${source.slug}" here is managed from "${state.managedFrom}", not from here.`,
    };
  }

  const warning = await featureWarning(db, source.feature);
  if (warning) base.warnings.push(warning);

  // ALREADY CURRENT IS PROVEN, NOT INFERRED. The evidence is the
  // target's live version_number; "we wrote zero rows" is not, because
  // zero rows is also what a broken query returns. E4.
  if (state.liveVersionNumber === source.versionNumber) {
    return {
      ...base,
      outcome: "already_current",
      detail: `Already running version ${source.versionNumber}.`,
    };
  }

  const verb = state.agentId ? "Update" : "Create";
  const movement =
    state.liveVersionNumber === null
      ? `to version ${source.versionNumber}`
      : `from version ${state.liveVersionNumber} to ${source.versionNumber}`;

  const { data: cat } = await db
    .from("agent_categories")
    .select("id")
    .eq("slug", source.categorySlug)
    .maybeSingle<{ id: string }>();

  if (!apply) {
    if (!cat) {
      base.warnings.push(
        `The category "${source.categoryName}" does not exist here and would be created.`
      );
    }
    return {
      ...base,
      outcome: "applied",
      detail: `${verb} "${source.title}" ${movement}.`,
    };
  }

  try {
    let categoryId: string;
    if (cat) {
      categoryId = cat.id;
    } else {
      const { data: made, error } = await db
        .from("agent_categories")
        .insert({ name: source.categoryName, slug: source.categorySlug })
        .select("id")
        .single<{ id: string }>();
      if (error || !made) throw new Error("could not create the category");
      categoryId = made.id;
      base.warnings.push(`Created the category "${source.categoryName}".`);
    }

    const agentFields = {
      slug: source.slug,
      category_id: categoryId,
      title: source.title,
      description: source.description,
      allowed_roles: source.allowedRoles,
      feature: source.feature,
      access_predicates: source.accessPredicates,
      managed_from: sourceSubdomain,
    };
    let agentId = state.agentId;
    if (agentId) {
      const { error } = await db.from("agents").update(agentFields).eq("id", agentId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await db
        .from("agents")
        .insert(agentFields)
        .select("id")
        .single<{ id: string }>();
      if (error || !data) throw new Error(error?.message ?? "insert failed");
      agentId = data.id;
    }

    // Through the one door (0230). Idempotent in the function itself,
    // so a retry returns the existing row's id rather than failing.
    const { data: versionId, error: versionErr } = await db.rpc(
      "insert_distributed_agent_version",
      {
        target_agent_id: agentId,
        v_version_number: source.versionNumber,
        v_prompt: source.prompt,
        v_chips: source.chips,
        v_base_prompt_mode: source.basePromptMode,
        v_skip_setup: source.skipSetup,
        v_first_turn: source.firstTurn,
        v_scripted_opener: source.scriptedOpener,
        v_tools: source.tools,
        v_max_tokens: source.maxTokens,
        v_model: source.model,
        v_publish_notes: source.publishNotes,
        v_actor: actorProfileId,
      }
    );
    if (versionErr || !versionId) {
      throw new Error(versionErr?.message ?? "the version was not written");
    }

    // LAST. See the header: a failure before this leaves the Hub-only
    // state rather than a broken agent.
    const { error: pointerErr } = await db
      .from("agents")
      .update({ live_version_id: versionId })
      .eq("id", agentId);
    if (pointerErr) throw new Error(pointerErr.message);

    return {
      ...base,
      outcome: "applied",
      detail: `${verb}d "${source.title}" ${movement}.`,
    };
  } catch (err) {
    return {
      ...base,
      outcome: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// Clearing a target's live pointer. The agent stays, its versions
// stay, conversations already pinned keep answering — the unpublish
// semantics phase 3 defined locally, arriving from outside.
export async function retractFromTarget(
  slug: string,
  target: Target,
  sourceSubdomain: string
): Promise<DistributionStep> {
  const base = {
    subdomain: target.subdomain,
    displayName: target.displayName,
    fromVersion: null as number | null,
    toVersion: null as number | null,
    warnings: [] as string[],
  };

  const db = await clientFor(target.subdomain);
  if (!db) {
    return { ...base, outcome: "failed", detail: "Could not reach this instance." };
  }
  const state = await readTargetState(db, slug);
  if (!state.agentId) {
    return { ...base, outcome: "refused", detail: "This instance does not have it." };
  }
  if (state.managedFrom !== sourceSubdomain) {
    return {
      ...base,
      outcome: "refused",
      detail: "This instance's copy is not managed from here.",
    };
  }
  base.fromVersion = state.liveVersionNumber;

  const { error } = await db
    .from("agents")
    .update({ live_version_id: null })
    .eq("id", state.agentId);
  if (error) return { ...base, outcome: "failed", detail: error.message };

  return {
    ...base,
    outcome: "retracted",
    detail:
      "Removed from every picker here. Conversations already running keep " +
      "answering on the version they started with.",
  };
}
