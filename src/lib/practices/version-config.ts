import "server-only";

import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import {
  loadPracticePrompt,
  type Practice,
  type PracticeToolName,
} from "./registry";
import { isValidAgentModel } from "./models";

// What an agent actually RUNS on, for one conversation.
//
// ---- THE PIN -------------------------------------------------
//
// A conversation carries `agent_version_id`, stamped when it was
// created or when its agent was last swapped. Every turn resolves
// config from THAT row. It does not consult the agent's live
// pointer, and it does not fall back to the live pointer if the
// pinned row has gone: falling back to live is the same as not
// pinning at all, and the whole phase exists to stop a publish
// changing what a running conversation says.
//
// A pinned id that cannot be read falls back to the REGISTRY, which
// is the one config guaranteed to exist and to be the shape the code
// was written against.
//
// ---- WHICH CLIENT READS THIS, AND WHY ------------------------
//
// The service-role client, which bypasses RLS. Said plainly here
// because it is the kind of thing that should never be discovered in
// a diff.
//
// `agent_versions` is system_admin-only to read (0228), and it has
// to be: it holds prompts, and a prompt is the product. But every
// member running a conversation needs the prompt of the version
// pinned to it, and a member is not a system admin. There is no
// policy that expresses "you may read the prompt of a version you
// are not allowed to know the existence of", so the read happens
// server-side instead, never in a browser.
//
// What keeps that narrow:
//   - this module is "server-only"; importing it from a client
//     component fails the build
//   - the read is by PRIMARY KEY of the version already pinned to a
//     conversation the caller has been authorised for, not a query
//     the caller can shape
//   - nothing here is returned to the browser. The coach route sends
//     the model's reply; the prompt never leaves the server. The
//     fields that DO reach the client (chips, outputCard) are
//     separated out below for exactly that reason.

export type AgentRuntimeConfig = {
  // Which of the two this came from, for the Hub to display and for
  // the log line when a fallback happens.
  source: "version" | "registry";
  versionId: string | null;
  versionNumber: number | null;

  // ---- server-side only ----
  prompt: string;
  basePromptMode: "full_coach" | "voice_only";
  tools: readonly PracticeToolName[];
  maxTokens: number | null;
  model: string | null;

  // ---- safe for the browser ----
  chips: readonly string[];
  skipSetup: boolean;
  firstTurn: "scripted" | "generate" | null;
  scriptedOpener: string | null;
};

// The closed lists. A stored version names tools and cards as
// STRINGS, because a row cannot hold a server function or a React
// component. Anything not on these lists is dropped rather than
// passed on: a card name the build does not ship would reach
// ChatView's switch and render nothing, and an unknown tool tag
// would be silently absent anyway. Dropping it here makes it one
// logged event instead of a mystery.
const KNOWN_TOOLS: ReadonlySet<string> = new Set<PracticeToolName>([
  "get_foundation",
  "list_functions",
  "get_role_description",
  "get_meeting_debrief",
]);

// Exported for the test that holds this list against
// PracticeToolName. Not for runtime use: callers ask
// configForVersion, which applies it.
export const KNOWN_TOOLS_FOR_TEST = KNOWN_TOOLS;

function modelOrNull(value: string | null, versionId: string): string | null {
  if (!value) return null;
  if (isValidAgentModel(value)) return value;
  warnOnce(
    `model:${versionId}:${value}`,
    `agent_versions ${versionId}: model "${value}" is not on the allowlist. ` +
      "Dropped, so this agent runs the platform default."
  );
  return null;
}

let warned: Set<string> | null = null;
function warnOnce(key: string, message: string) {
  warned ??= new Set();
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

type VersionRow = {
  id: string;
  agent_id: string;
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
};

const VERSION_COLUMNS =
  "id, agent_id, version_number, prompt, chips, base_prompt_mode, " +
  "skip_setup, first_turn, scripted_opener, output_card, tools, " +
  "max_tokens, model";

export const loadVersionRow = cache(async function loadVersionRow(
  versionId: string
): Promise<VersionRow | null> {
  try {
    const db = await createSupabaseAdminClient(getCurrentInstanceConfig());
    const { data, error } = await db
      .from("agent_versions")
      .select(VERSION_COLUMNS)
      .eq("id", versionId)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as VersionRow;
  } catch {
    // The table not existing is this path too, which is what lets
    // 0228 land ahead of a deploy.
    return null;
  }
});

// The registry's own config, as an AgentRuntimeConfig. This is what
// every agent runs on until somebody publishes, and the fallback
// whenever a pinned version cannot be read.
export async function registryConfig(
  practice: Practice
): Promise<AgentRuntimeConfig> {
  return {
    source: "registry",
    versionId: null,
    versionNumber: null,
    prompt: await loadPracticePrompt(practice),
    basePromptMode: practice.basePromptMode,
    tools: practice.tools ?? [],
    maxTokens: practice.maxTokens ?? null,
    model: null,
    chips: practice.chips ?? [],
    skipSetup: practice.skipSetup,
    firstTurn: practice.firstTurn ?? null,
    scriptedOpener: practice.scriptedOpener ?? null,
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

// A version row is SELF-CONTAINED: it carries every field the
// runtime needs, so nothing falls back to the registry entry here.
// That is deliberate rather than incidental — a pinned conversation
// must reproduce its config years later, and a config assembled
// half from a row and half from whatever the code says today is not
// reproducible. The registry's only remaining job for a published
// agent is to be the fallback when the row cannot be read at all.
export function configFromVersion(row: VersionRow): AgentRuntimeConfig {
  const tools = asStringArray(row.tools).filter((t) => {
    if (KNOWN_TOOLS.has(t)) return true;
    warnOnce(
      `tool:${row.id}:${t}`,
      `agent_versions ${row.id}: tool "${t}" is not one this build ships. ` +
        "Dropped."
    );
    return false;
  }) as PracticeToolName[];

  return {
    source: "version",
    versionId: row.id,
    versionNumber: row.version_number,
    prompt: row.prompt,
    basePromptMode:
      row.base_prompt_mode === "voice_only" ? "voice_only" : "full_coach",
    tools,
    maxTokens: row.max_tokens,
    // An unrecognised model is dropped, which falls the caller back
    // to the platform default. Same reasoning as tools and cards
    // above: the allowlist is code, so a version can name a model
    // that has since been retired, and sending it to the API would
    // fail the turn in front of a client.
    model: modelOrNull(row.model, row.id),
    chips: asStringArray(row.chips),
    skipSetup: row.skip_setup,
    firstTurn:
      row.first_turn === "scripted" || row.first_turn === "generate"
        ? row.first_turn
        : null,
    scriptedOpener: row.scripted_opener,
  };
}

// THE function the runtime calls.
//
// `pinnedVersionId` is the conversation's own column. Null means
// registry-defined, which is every conversation that existed before
// phase 2 and every conversation on an agent nobody has published.
export const resolveRuntimeConfig = cache(async function resolveRuntimeConfig(
  practice: Practice & { isDatabaseDefined?: boolean; liveVersionId?: string | null },
  pinnedVersionId: string | null
): Promise<AgentRuntimeConfig> {
  // ---- a database-defined agent has NO code to fall back to ----
  //
  // Phase 3. `registryConfig` would try to read a prompt file that
  // does not exist, so every path below has to be explicit about it.
  if (practice.isDatabaseDefined) {
    // No pin should be possible — such an agent only reaches a
    // picker with a live version, and creation stamps from it — but
    // if one arrives, its live version is the only honest answer.
    const id = pinnedVersionId ?? practice.liveVersionId ?? null;
    const row = id ? await loadVersionRow(id) : null;
    if (row) return configFromVersion(row);

    // Nothing left to run. Version rows are immutable and nothing
    // holds DELETE, so this is close to unreachable — but "close to"
    // is not "never", and a chat that throws is worse than one that
    // carries on without the agent's instructions. Degrade to the
    // base prompt and say so loudly.
    warnOnce(
      `orphan:${practice.id}`,
      `agent "${practice.id}" is database-defined and its version ` +
        `(${id ?? "none"}) could not be read. There is no code fallback, so ` +
        "this conversation runs on the base prompt alone. Investigate: a " +
        "version row should never be missing."
    );
    return {
      source: "version",
      versionId: id,
      versionNumber: null,
      prompt: "",
      basePromptMode: "full_coach",
      tools: [],
      maxTokens: null,
      model: null,
      chips: [],
      skipSetup: false,
      firstTurn: null,
      scriptedOpener: null,
    };
  }

  if (!pinnedVersionId) return registryConfig(practice);

  const row = await loadVersionRow(pinnedVersionId);
  if (!row) {
    // NOT the live pointer. See the header: falling back to live is
    // the same as not pinning.
    warnOnce(
      `missing:${pinnedVersionId}`,
      `agent_versions ${pinnedVersionId} is pinned to a conversation but ` +
        "could not be read. Falling back to the code registry, NOT to the " +
        "agent's live version: a pinned conversation must never silently " +
        "adopt whatever is current."
    );
    return registryConfig(practice);
  }
  return configFromVersion(row);
});

// What an agent's NEW conversations should be stamped with. Null
// when the agent has no live version, which means "registry".
export async function liveVersionIdFor(
  agentRowId: string | null
): Promise<string | null> {
  if (!agentRowId) return null;
  try {
    const db = await createSupabaseAdminClient(getCurrentInstanceConfig());
    const { data, error } = await db
      .from("agents")
      .select("live_version_id")
      .eq("id", agentRowId)
      .maybeSingle<{ live_version_id: string | null }>();
    if (error || !data) return null;
    return data.live_version_id;
  } catch {
    return null;
  }
}
