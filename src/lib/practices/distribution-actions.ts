"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import {
  distributeToTarget,
  distributionTargets,
  retractFromTarget,
  type DistributionSource,
  type Target,
} from "./distribution";
import {
  distributionApplyEnabled,
  DISTRIBUTION_GATE_MESSAGE,
} from "./distribution-gate";
import type {
  DistributionPlan,
  DistributionStep,
  InstanceDistributionRow,
} from "./distribution-types";

// system_admin only, on the main instance, and every WRITE behind the
// apply gate — checked here rather than only in the UI, because a
// disabled button is a hint and this is the control.

export type DistributionResult =
  | { ok: true; plan: DistributionPlan }
  | { ok: false; message: string };

// The agent and its LIVE version, as the source of a push. Null when
// there is nothing to send: an agent with no live version has no
// config anybody has approved.
async function loadSource(agentRowId: string): Promise<
  | { ok: true; source: DistributionSource }
  | { ok: false; message: string }
> {
  const db = await createSupabaseServerClient(await getCurrentInstanceConfig());
  const { data: agent } = await db
    .from("agents")
    .select(
      "id, slug, title, description, allowed_roles, feature, access_predicates, " +
        "managed_from, live_version_id, agent_categories ( name, slug )"
    )
    .eq("id", agentRowId)
    .maybeSingle();
  const a = agent as unknown as {
    slug: string;
    title: string;
    description: string;
    allowed_roles: string[] | null;
    feature: string | null;
    access_predicates: string[] | null;
    managed_from: string | null;
    live_version_id: string | null;
    agent_categories: { name: string; slug: string } | null;
  } | null;
  if (!a) return { ok: false, message: "That agent no longer exists." };

  if (a.managed_from) {
    return {
      ok: false,
      message:
        "This agent is managed from another instance, so it cannot be " +
        "distributed from here.",
    };
  }
  if (!a.live_version_id) {
    return {
      ok: false,
      message:
        "This agent has nothing published, so there is nothing to send. " +
        "Publish it here first.",
    };
  }
  if (!a.agent_categories) {
    return { ok: false, message: "That agent has no category." };
  }

  const { data: v } = await db
    .from("agent_versions")
    .select(
      "version_number, prompt, chips, base_prompt_mode, skip_setup, " +
        "first_turn, scripted_opener, tools, max_tokens, model, publish_notes"
    )
    .eq("id", a.live_version_id)
    .maybeSingle();
  const row = v as unknown as {
    version_number: number;
    prompt: string;
    chips: unknown;
    base_prompt_mode: string;
    skip_setup: boolean;
    first_turn: string | null;
    scripted_opener: string | null;
    tools: string[] | null;
    max_tokens: number | null;
    model: string | null;
    publish_notes: string;
  } | null;
  if (!row) {
    return { ok: false, message: "Could not read the live version." };
  }

  return {
    ok: true,
    source: {
      slug: a.slug,
      title: a.title,
      description: a.description,
      categorySlug: a.agent_categories.slug,
      categoryName: a.agent_categories.name,
      allowedRoles: a.allowed_roles ?? [],
      feature: a.feature,
      accessPredicates: a.access_predicates ?? [],
      versionNumber: row.version_number,
      prompt: row.prompt,
      chips: row.chips,
      basePromptMode: row.base_prompt_mode,
      skipSetup: row.skip_setup,
      firstTurn: row.first_turn,
      scriptedOpener: row.scripted_opener,
      tools: row.tools ?? [],
      maxTokens: row.max_tokens,
      model: row.model,
      publishNotes: row.publish_notes,
    },
  };
}

async function chosenTargets(subdomains: string[]): Promise<Target[]> {
  const all = await distributionTargets();
  if (subdomains.length === 0) return all;
  const wanted = new Set(subdomains);
  return all.filter((t) => wanted.has(t.subdomain));
}

// ---- Dry run ----------------------------------------------------
//
// Read-only by construction. It reads three tables on each target —
// agents, agent_categories, company_features — and writes nothing,
// which is what makes it safe to run against a live client instance
// while the apply path is still gated.
export async function dryRunDistributionAction(
  agentRowId: string,
  subdomains: string[]
): Promise<DistributionResult> {
  const session = await requireRole(["system_admin"]);
  const loaded = await loadSource(agentRowId);
  if (!loaded.ok) {
    return {
      ok: true,
      plan: {
        agentSlug: "",
        versionNumber: null,
        steps: [],
        pushable: false,
        blockedReason: loaded.message,
      },
    };
  }
  const here = await getCurrentInstanceConfig();
  const targets = await chosenTargets(subdomains);

  const steps: DistributionStep[] = [];
  for (const target of targets) {
    steps.push(
      await distributeToTarget(
        loaded.source,
        target,
        session.profile.id,
        here.subdomain,
        false
      )
    );
  }
  return {
    ok: true,
    plan: {
      agentSlug: loaded.source.slug,
      versionNumber: loaded.source.versionNumber,
      steps,
      pushable: steps.some((s) => s.outcome === "applied"),
      blockedReason: null,
    },
  };
}

// ---- Apply ------------------------------------------------------
export async function applyDistributionAction(
  agentRowId: string,
  subdomains: string[]
): Promise<DistributionResult> {
  const session = await requireRole(["system_admin"]);
  // THE GATE. Server-side, before anything else happens.
  if (!distributionApplyEnabled()) {
    return { ok: false, message: DISTRIBUTION_GATE_MESSAGE };
  }
  const loaded = await loadSource(agentRowId);
  if (!loaded.ok) return { ok: false, message: loaded.message };

  const here = await getCurrentInstanceConfig();
  const targets = await chosenTargets(subdomains);

  const steps: DistributionStep[] = [];
  for (const target of targets) {
    // Per-instance isolation: one failure never stops the rest, the
    // same property for-each.ts is built around.
    const started = new Date().toISOString();
    const step = await distributeToTarget(
      loaded.source,
      target,
      session.profile.id,
      here.subdomain,
      true
    );
    steps.push(step);
    await writeReceipt(loaded.source.slug, step, session.profile.id, started);
  }

  refresh();
  return {
    ok: true,
    plan: {
      agentSlug: loaded.source.slug,
      versionNumber: loaded.source.versionNumber,
      steps,
      pushable: false,
      blockedReason: null,
    },
  };
}

// ---- Retract ----------------------------------------------------
//
// A write, so it is behind the same gate as apply.
export async function retractDistributionAction(
  agentRowId: string,
  subdomain: string
): Promise<DistributionResult> {
  const session = await requireRole(["system_admin"]);
  if (!distributionApplyEnabled()) {
    return { ok: false, message: DISTRIBUTION_GATE_MESSAGE };
  }
  const loaded = await loadSource(agentRowId);
  const slug = loaded.ok ? loaded.source.slug : null;
  if (!slug) {
    return { ok: false, message: loaded.ok ? "No agent." : loaded.message };
  }

  const here = await getCurrentInstanceConfig();
  const target = (await distributionTargets()).find(
    (t) => t.subdomain === subdomain
  );
  if (!target) return { ok: false, message: "That instance is not a target." };

  const started = new Date().toISOString();
  const step = await retractFromTarget(slug, target, here.subdomain);
  await writeReceipt(slug, step, session.profile.id, started);

  refresh();
  return {
    ok: true,
    plan: {
      agentSlug: slug,
      versionNumber: null,
      steps: [step],
      pushable: false,
      blockedReason: null,
    },
  };
}

async function writeReceipt(
  slug: string,
  step: DistributionStep,
  actor: string,
  startedAt: string
): Promise<void> {
  const db = await createSupabaseServerClient(await getCurrentInstanceConfig());
  await db.from("agent_distributions").insert({
    agent_slug: slug,
    version_number: step.toVersion,
    target_subdomain: step.subdomain,
    targeting: "all_companies",
    actor,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    outcome: step.outcome,
    detail: [step.detail, ...step.warnings].join(" "),
  });
}

function refresh() {
  revalidatePath("/admin/agents");
}

// ---- The panel's rows -------------------------------------------
//
// Derived from the log, not from the targets: "never distributed" is
// the absence of a receipt, and that is the honest way to say it.
export async function distributionRowsAction(
  agentRowId: string
): Promise<
  | { ok: true; rows: InstanceDistributionRow[]; applyEnabled: boolean; liveVersion: number | null }
  | { ok: false; message: string }
> {
  await requireRole(["system_admin"]);
  const db = await createSupabaseServerClient(await getCurrentInstanceConfig());

  const { data: agent } = await db
    .from("agents")
    .select("slug, live_version_id")
    .eq("id", agentRowId)
    .maybeSingle<{ slug: string; live_version_id: string | null }>();
  if (!agent) return { ok: false, message: "That agent no longer exists." };

  let liveVersion: number | null = null;
  if (agent.live_version_id) {
    const { data: v } = await db
      .from("agent_versions")
      .select("version_number")
      .eq("id", agent.live_version_id)
      .maybeSingle<{ version_number: number }>();
    liveVersion = v?.version_number ?? null;
  }

  const { data: log } = await db
    .from("agent_distributions")
    .select("target_subdomain, version_number, finished_at, outcome, detail")
    .eq("agent_slug", agent.slug)
    .order("started_at", { ascending: false });

  const latest = new Map<
    string,
    {
      version_number: number | null;
      finished_at: string | null;
      outcome: InstanceDistributionRow["lastOutcome"];
      detail: string;
    }
  >();
  for (const r of (log ?? []) as Array<{
    target_subdomain: string;
    version_number: number | null;
    finished_at: string | null;
    outcome: NonNullable<InstanceDistributionRow["lastOutcome"]>;
    detail: string;
  }>) {
    if (!latest.has(r.target_subdomain)) {
      latest.set(r.target_subdomain, {
        version_number: r.version_number,
        finished_at: r.finished_at,
        outcome: r.outcome,
        detail: r.detail,
      });
    }
  }

  const rows: InstanceDistributionRow[] = (await distributionTargets()).map(
    (t) => {
      const last = latest.get(t.subdomain);
      if (!last) {
        return {
          subdomain: t.subdomain,
          displayName: t.displayName,
          status: "never",
          distributedVersion: null,
          lastPushedAt: null,
          lastOutcome: null,
          lastDetail: "",
        };
      }
      const status: InstanceDistributionRow["status"] =
        last.outcome === "retracted"
          ? "retracted"
          : last.outcome === "failed"
            ? "failed"
            : last.outcome === "refused"
              ? "refused"
              : last.version_number === liveVersion
                ? "current"
                : "behind";
      return {
        subdomain: t.subdomain,
        displayName: t.displayName,
        status,
        distributedVersion: last.version_number,
        lastPushedAt: last.finished_at,
        lastOutcome: last.outcome,
        lastDetail: last.detail,
      };
    }
  );

  return { ok: true, rows, applyEnabled: distributionApplyEnabled(), liveVersion };
}

// How many instances still hold this agent, for the delete confirm.
export async function distributedInstanceCountAction(
  slug: string
): Promise<number> {
  await requireRole(["system_admin"]);
  const db = await createSupabaseServerClient(await getCurrentInstanceConfig());
  const { data } = await db
    .from("agent_distributions")
    .select("target_subdomain, outcome")
    .eq("agent_slug", slug)
    .in("outcome", ["applied", "already_current"]);
  const held = new Set(
    ((data ?? []) as Array<{ target_subdomain: string }>).map(
      (r) => r.target_subdomain
    )
  );
  return held.size;
}
