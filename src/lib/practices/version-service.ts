import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { PRACTICES } from "./registry";
import { registryConfig } from "./version-config";
import type { AgentRuntimeConfig } from "./version-config";

// What the Config tab reads.
//
// On the CALLER's client, not the service role: this runs for a
// system admin looking at the Hub, and agent_versions' select policy
// already says system_admin only. Using the admin client here would
// hand the page a privilege it does not need and would make the
// policy untested in practice. The service-role read exists in
// exactly one place, version-config.ts, for the runtime.

export type AgentVersionSummary = {
  id: string;
  versionNumber: number;
  publishNotes: string;
  publishedAt: string | null;
  publishedByName: string | null;
  isLive: boolean;
  isDraft: boolean;
};

export type AgentVersionDetail = AgentVersionSummary & {
  prompt: string;
  chips: string[];
  basePromptMode: "full_coach" | "voice_only";
  skipSetup: boolean;
  firstTurn: "scripted" | "generate" | null;
  scriptedOpener: string | null;
  outputCard: Record<string, string>;
  tools: string[];
  maxTokens: number | null;
  model: string | null;
};

const DETAIL_COLUMNS =
  "id, version_number, prompt, chips, base_prompt_mode, skip_setup, " +
  "first_turn, scripted_opener, output_card, tools, max_tokens, model, " +
  "publish_notes, published_at, published_by, profiles:published_by ( full_name )";

type Row = {
  id: string;
  version_number: number;
  prompt: string;
  chips: unknown;
  base_prompt_mode: string;
  skip_setup: boolean;
  first_turn: string | null;
  scripted_opener: string | null;
  output_card: unknown;
  tools: string[] | null;
  max_tokens: number | null;
  model: string | null;
  publish_notes: string;
  published_at: string | null;
  published_by: string | null;
  profiles: { full_name: string | null } | null;
};

function toDetail(
  r: Row,
  liveId: string | null,
  draftId: string | null
): AgentVersionDetail {
  return {
    id: r.id,
    versionNumber: r.version_number,
    publishNotes: r.publish_notes,
    publishedAt: r.published_at,
    publishedByName: r.profiles?.full_name ?? null,
    isLive: r.id === liveId,
    isDraft: r.id === draftId,
    prompt: r.prompt,
    chips: Array.isArray(r.chips)
      ? (r.chips as unknown[]).filter((c): c is string => typeof c === "string")
      : [],
    basePromptMode:
      r.base_prompt_mode === "voice_only" ? "voice_only" : "full_coach",
    skipSetup: r.skip_setup,
    firstTurn:
      r.first_turn === "scripted" || r.first_turn === "generate"
        ? r.first_turn
        : null,
    scriptedOpener: r.scripted_opener,
    outputCard:
      r.output_card && typeof r.output_card === "object" && !Array.isArray(r.output_card)
        ? (r.output_card as Record<string, string>)
        : {},
    tools: r.tools ?? [],
    maxTokens: r.max_tokens,
    model: r.model,
  };
}

export type AgentConfigView = {
  // Which config an agent is RUNNING. "registry" until somebody
  // publishes, which is every agent today.
  liveSource: "registry" | "version";
  live: AgentVersionDetail | null;
  draft: AgentVersionDetail | null;
  history: AgentVersionSummary[];
  // The registry entry's config, always available: it is what "Edit
  // in Hub" copies into a first draft, and what the diff compares
  // against when nothing is live.
  registry: AgentRuntimeConfig | null;
};

export async function loadAgentConfig(
  agentRowId: string,
  slug: string,
  liveId: string | null,
  draftId: string | null
): Promise<AgentConfigView> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await db
    .from("agent_versions")
    .select(DETAIL_COLUMNS)
    .eq("agent_id", agentRowId)
    .order("version_number", { ascending: false });

  const rows = ((data ?? []) as unknown as Row[]).map((r) =>
    toDetail(r, liveId, draftId)
  );

  const practice = PRACTICES.find((p) => p.id === slug) ?? null;

  return {
    liveSource: liveId ? "version" : "registry",
    live: rows.find((r) => r.isLive) ?? null,
    draft: rows.find((r) => r.isDraft) ?? null,
    history: rows.map(({ prompt: _p, ...summary }) => summary),
    registry: practice ? await registryConfig(practice) : null,
  };
}
