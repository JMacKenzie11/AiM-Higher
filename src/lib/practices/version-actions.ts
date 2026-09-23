"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { PRACTICES, type OutputCardName, type PracticeToolName } from "./registry";
import { registryConfig } from "./version-config";
import { FUNCTION_LEAD_PREDICATE } from "./hub-constants";
import { isValidAgentModel } from "./models";

// Writes for agent config. system_admin only, enforced by RLS (0228)
// and failed fast here.
//
// ---- EVERY WRITE IS AN INSERT ---------------------------------
//
// agent_versions holds no UPDATE or DELETE privilege for any role,
// so "editing a draft" is not an update: it inserts a new version
// row and moves agents.draft_version_id at it. The superseded draft
// stays as history. That is the point — a version a conversation
// might be pinned to can never be rewritten underneath it, and the
// database refuses rather than relying on anybody remembering.

export type VersionResult =
  | { ok: true; versionId?: string }
  | { ok: false; message: string };

const KNOWN_TOOLS = new Set<string>([
  "get_foundation",
  "list_functions",
  "get_role_description",
] satisfies PracticeToolName[]);

const KNOWN_CARDS = new Set<string>([
  "ScriptCard",
  "ChartProposalCard",
  "RoleDescriptionCard",
] satisfies OutputCardName[]);

export type DraftInput = {
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

function refresh() {
  revalidatePath("/admin/agents");
  revalidatePath("/ask-aimee", "layout");
}

async function db() {
  return createSupabaseServerClient(getCurrentInstanceConfig());
}

function validate(input: DraftInput): string | null {
  if (!input.prompt.trim()) {
    return "An agent with no prompt has nothing to say. Write the prompt first.";
  }
  if (input.prompt.length > 60000) {
    return "That prompt is over 60,000 characters. Something has gone wrong.";
  }
  for (const t of input.tools) {
    if (!KNOWN_TOOLS.has(t)) return `"${t}" isn't a tool this system has.`;
  }
  for (const card of Object.values(input.outputCard)) {
    if (!KNOWN_CARDS.has(card)) return `"${card}" isn't a card this system has.`;
  }
  // The dropdown already limits this. The action checks anyway,
  // because a dropdown is a suggestion and the action is the
  // boundary — and a typo'd model id is a broken agent found by a
  // client rather than by the admin who made it.
  if (!isValidAgentModel(input.model)) {
    return "That isn't a model this system offers.";
  }
  if (
    input.maxTokens !== null &&
    (input.maxTokens < 256 || input.maxTokens > 32000)
  ) {
    return "Token ceiling has to be between 256 and 32,000.";
  }
  if (input.firstTurn === "scripted" && !input.scriptedOpener?.trim()) {
    return "A scripted opener needs the opening line written out.";
  }
  return null;
}

// The next version number for an agent. Read-then-insert rather than
// a sequence, because numbering is PER AGENT and a shared sequence
// would make version 3 of one agent and version 9 of another out of
// two consecutive edits. The unique(agent_id, version_number)
// constraint is what makes a lost race fail loudly instead of
// duplicating a number.
async function nextVersionNumber(
  supabase: Awaited<ReturnType<typeof db>>,
  agentRowId: string
): Promise<number> {
  const { data } = await supabase
    .from("agent_versions")
    .select("version_number")
    .eq("agent_id", agentRowId)
    .order("version_number", { ascending: false })
    .limit(1);
  const top = (data ?? [])[0] as { version_number: number } | undefined;
  return (top?.version_number ?? 0) + 1;
}

async function insertVersion(
  supabase: Awaited<ReturnType<typeof db>>,
  agentRowId: string,
  input: DraftInput,
  publishNotes: string,
  profileId: string | null
): Promise<{ id: string } | { error: string }> {
  const version_number = await nextVersionNumber(supabase, agentRowId);
  const { data, error } = await supabase
    .from("agent_versions")
    .insert({
      agent_id: agentRowId,
      version_number,
      prompt: input.prompt,
      chips: input.chips,
      base_prompt_mode: input.basePromptMode,
      skip_setup: input.skipSetup,
      first_turn: input.firstTurn,
      scripted_opener: input.scriptedOpener,
      output_card: input.outputCard,
      tools: input.tools,
      max_tokens: input.maxTokens,
      model: input.model,
      publish_notes: publishNotes,
      published_by: profileId,
      published_at: publishNotes ? new Date().toISOString() : null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    return {
      error:
        "Couldn't save that version. If another admin was editing the same " +
        "agent, reload and try again.",
    };
  }
  return { id: data.id };
}

// ---- Edit in Hub -----------------------------------------------
//
// Copies the agent's CURRENT config into a first draft. Current means
// the live version if there is one, the registry entry otherwise.
// Explicit and reversible: nothing an agent does changes until
// somebody publishes.
export async function startDraftAction(
  agentRowId: string,
  slug: string
): Promise<VersionResult> {
  const session = await requireRole(["system_admin"]);
  const supabase = await db();

  const { data: agent } = await supabase
    .from("agents")
    .select("id, live_version_id")
    .eq("id", agentRowId)
    .maybeSingle<{ id: string; live_version_id: string | null }>();
  if (!agent) return { ok: false, message: "That agent no longer exists." };

  let seed: DraftInput;
  if (agent.live_version_id) {
    const { data: live } = await supabase
      .from("agent_versions")
      .select(
        "prompt, chips, base_prompt_mode, skip_setup, first_turn, " +
          "scripted_opener, output_card, tools, max_tokens, model"
      )
      .eq("id", agent.live_version_id)
      .maybeSingle();
    const r = live as Record<string, unknown> | null;
    if (!r) return { ok: false, message: "Couldn't read the live version." };
    seed = {
      prompt: String(r.prompt ?? ""),
      chips: Array.isArray(r.chips) ? (r.chips as string[]) : [],
      basePromptMode:
        r.base_prompt_mode === "voice_only" ? "voice_only" : "full_coach",
      skipSetup: Boolean(r.skip_setup),
      firstTurn:
        r.first_turn === "scripted" || r.first_turn === "generate"
          ? r.first_turn
          : null,
      scriptedOpener: (r.scripted_opener as string | null) ?? null,
      outputCard: (r.output_card as Record<string, string>) ?? {},
      tools: (r.tools as string[]) ?? [],
      maxTokens: (r.max_tokens as number | null) ?? null,
      model: (r.model as string | null) ?? null,
    };
  } else {
    const practice = PRACTICES.find((p) => p.id === slug);
    if (!practice) {
      return {
        ok: false,
        message:
          "This agent has no code entry to copy from, so there is nothing to seed a draft with.",
      };
    }
    const c = await registryConfig(practice);
    seed = {
      prompt: c.prompt,
      chips: [...c.chips],
      basePromptMode: c.basePromptMode,
      skipSetup: c.skipSetup,
      firstTurn: c.firstTurn,
      scriptedOpener: c.scriptedOpener,
      outputCard: { ...(c.outputCard ?? {}) },
      tools: [...c.tools],
      maxTokens: c.maxTokens,
      model: c.model,
    };
  }

  const inserted = await insertVersion(supabase, agentRowId, seed, "", session.profile.id);
  if ("error" in inserted) return { ok: false, message: inserted.error };

  const { error } = await supabase
    .from("agents")
    .update({ draft_version_id: inserted.id })
    .eq("id", agentRowId);
  if (error) return { ok: false, message: "Couldn't start that draft." };
  refresh();
  return { ok: true, versionId: inserted.id };
}

// ---- Save a draft ----------------------------------------------
//
// Inserts a NEW version and moves the draft pointer. The superseded
// draft stays on file: it cost a model call to write and somebody
// may want it back.
export async function saveDraftAction(
  agentRowId: string,
  input: DraftInput
): Promise<VersionResult> {
  const session = await requireRole(["system_admin"]);
  const problem = validate(input);
  if (problem) return { ok: false, message: problem };

  const supabase = await db();
  const inserted = await insertVersion(supabase, agentRowId, input, "", session.profile.id);
  if ("error" in inserted) return { ok: false, message: inserted.error };

  const { error } = await supabase
    .from("agents")
    .update({ draft_version_id: inserted.id })
    .eq("id", agentRowId);
  if (error) return { ok: false, message: "Couldn't save that draft." };
  refresh();
  return { ok: true, versionId: inserted.id };
}

// ---- Publish ----------------------------------------------------
//
// Moves live_version_id, and nothing else. Conversations already
// running keep the version pinned to them; only conversations
// started AFTER this get the new one.
export async function publishDraftAction(
  agentRowId: string,
  versionId: string,
  notes: string
): Promise<VersionResult> {
  const session = await requireRole(["system_admin"]);
  const trimmed = notes.trim();
  if (!trimmed) {
    return {
      ok: false,
      message:
        "Publish notes are required. They are the commit message for a change to what every company's agent says.",
    };
  }
  if (trimmed.length > 1000) {
    return { ok: false, message: "Keep publish notes under 1,000 characters." };
  }

  const supabase = await db();

  // The version is immutable, so the notes cannot be written onto
  // it. Publishing copies it into a NEW version carrying the notes,
  // the publisher and the timestamp — which is also what makes
  // "published twice with different notes" two entries in history
  // rather than one row that changed its mind.
  const { data: src } = await supabase
    .from("agent_versions")
    .select(
      "prompt, chips, base_prompt_mode, skip_setup, first_turn, " +
        "scripted_opener, output_card, tools, max_tokens, model"
    )
    .eq("id", versionId)
    .eq("agent_id", agentRowId)
    .maybeSingle();
  const r = src as Record<string, unknown> | null;
  if (!r) return { ok: false, message: "That version no longer exists." };

  const input: DraftInput = {
    prompt: String(r.prompt ?? ""),
    chips: Array.isArray(r.chips) ? (r.chips as string[]) : [],
    basePromptMode:
      r.base_prompt_mode === "voice_only" ? "voice_only" : "full_coach",
    skipSetup: Boolean(r.skip_setup),
    firstTurn:
      r.first_turn === "scripted" || r.first_turn === "generate"
        ? r.first_turn
        : null,
    scriptedOpener: (r.scripted_opener as string | null) ?? null,
    outputCard: (r.output_card as Record<string, string>) ?? {},
    tools: (r.tools as string[]) ?? [],
    maxTokens: (r.max_tokens as number | null) ?? null,
    model: (r.model as string | null) ?? null,
  };
  const problem = validate(input);
  if (problem) return { ok: false, message: problem };

  const inserted = await insertVersion(
    supabase,
    agentRowId,
    input,
    trimmed,
    session.profile.id
  );
  if ("error" in inserted) return { ok: false, message: inserted.error };

  const { error } = await supabase
    .from("agents")
    .update({ live_version_id: inserted.id, draft_version_id: null })
    .eq("id", agentRowId);
  if (error) return { ok: false, message: "Couldn't publish that version." };
  refresh();
  return { ok: true, versionId: inserted.id };
}

// ---- Revert to the code default ---------------------------------
//
// Clears live_version_id. New conversations go back to running the
// registry; pinned ones are untouched, which is why this is safe to
// press.
export async function revertToCodeAction(
  agentRowId: string
): Promise<VersionResult> {
  await requireRole(["system_admin"]);
  const supabase = await db();
  const { error } = await supabase
    .from("agents")
    .update({ live_version_id: null })
    .eq("id", agentRowId);
  if (error) return { ok: false, message: "Couldn't revert that agent." };
  refresh();
  return { ok: true };
}

// ---- Discard the draft ------------------------------------------
export async function discardDraftAction(
  agentRowId: string
): Promise<VersionResult> {
  await requireRole(["system_admin"]);
  const supabase = await db();
  // The pointer moves; the rows stay. Nothing can delete a version.
  const { error } = await supabase
    .from("agents")
    .update({ draft_version_id: null })
    .eq("id", agentRowId);
  if (error) return { ok: false, message: "Couldn't discard that draft." };
  refresh();
  return { ok: true };
}

// ---- Preview -----------------------------------------------------
//
// Starts a real conversation that runs an UNPUBLISHED draft.
//
// It needs no special runtime path, which is the nice part: a
// conversation already runs whatever version is pinned to it, so
// pinning the DRAFT is the whole implementation. The draft is never
// live, so no other conversation can reach it.
//
// HOW THE THREE GUARANTEES ARE ENFORCED, since asserting them is not
// the same as having them:
//
//   visible only to its admin — `created_by` is the caller and
//     coaching_conversations is owner-scoped (0021/0105). Not a new
//     rule; the same one that keeps every Ask Aimee thread private.
//     The Hub never offers to share a preview, so the share path
//     (0150) is not reachable from the surface that makes one.
//
//   clearly labelled — the title is prefixed, and the conversation
//     carries is_preview for anything that wants to badge it.
//
//   out of memory — the sweep filters `practice_id is null`, and a
//     preview always carries a practice_id. Excluded by a rule that
//     predates previews entirely.
//
//   out of analytics — is_preview, checked by all seven aggregate
//     queries and held there by preview-exclusion.test.ts. Those
//     queries run on the service-role client with RLS bypassed, so
//     no policy could have done this for them.
export async function startPreviewAction(
  agentRowId: string,
  slug: string,
  versionId: string
): Promise<VersionResult & { conversationId?: string }> {
  const session = await requireRole(["system_admin"]);
  const supabase = await db();

  const { getEffectiveCompanyId } = await import("@/lib/admin/scope");
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) {
    return {
      ok: false,
      message:
        "Scope into a company first. A preview runs against a company's context, the same as any conversation.",
    };
  }

  const { data: version } = await supabase
    .from("agent_versions")
    .select("id, version_number")
    .eq("id", versionId)
    .eq("agent_id", agentRowId)
    .maybeSingle<{ id: string; version_number: number }>();
  if (!version) return { ok: false, message: "That version no longer exists." };

  const { data, error } = await supabase
    .from("coaching_conversations")
    .insert({
      company_id: companyId,
      subject_profile_id: null,
      created_by: session.profile.id,
      title: `Preview · ${slug} v${version.version_number}`,
      context_kind: "execution",
      mode: "general",
      practice_id: slug,
      agent_version_id: version.id,
      is_preview: true,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    return { ok: false, message: "Couldn't start that preview." };
  }
  refresh();
  return { ok: true, conversationId: data.id };
}

// ---- The Config tab's read ---------------------------------------
//
// An action rather than page data, deliberately. This returns PROMPT
// TEXT, and the Hub lists every agent: loading it for all of them up
// front would put every prompt in the page payload to render one
// drawer. Fetched when a drawer opens, for the one agent it is about.
export async function loadAgentConfigAction(
  agentRowId: string
): Promise<
  | { ok: true; view: import("./version-service").AgentConfigView }
  | { ok: false; message: string }
> {
  await requireRole(["system_admin"]);
  const supabase = await db();
  const { data: agent } = await supabase
    .from("agents")
    .select("id, slug, live_version_id, draft_version_id")
    .eq("id", agentRowId)
    .maybeSingle<{
      id: string;
      slug: string;
      live_version_id: string | null;
      draft_version_id: string | null;
    }>();
  if (!agent) return { ok: false, message: "That agent no longer exists." };

  const { loadAgentConfig } = await import("./version-service");
  const view = await loadAgentConfig(
    agent.id,
    agent.slug,
    agent.live_version_id,
    agent.draft_version_id
  );
  return { ok: true, view };
}

// =============================================================
// Phase 3: net-new agents
//
// An agent with no registry entry behind it. It walks the SAME
// draft, preview and publish path as everything above — this phase
// adds no version machinery, only a way in and a way out.
// =============================================================

// ---- Create ---------------------------------------------------
//
// Writes the agents row and a first draft version together. Nothing
// is visible to anybody but a system admin at this point, because
// there is no live version and the merge layer only offers a
// database-defined agent once there is one.
export async function createAgentAction(input: {
  title: string;
  description: string;
  categoryId: string;
  allowedRoles: string[];
  feature: string | null;
  functionLead: boolean;
  config: DraftInput;
}): Promise<VersionResult & { agentRowId?: string; slug?: string }> {
  const session = await requireRole(["system_admin"]);

  const title = input.title.trim();
  const description = input.description.trim();
  if (!title) return { ok: false, message: "Give the agent a name." };
  if (title.length > 80) {
    return { ok: false, message: "Keep the name under 80 characters." };
  }
  if (!description) {
    return {
      ok: false,
      message: "Give the agent a description. It is the line under the name on the card.",
    };
  }
  if (!input.categoryId) {
    return { ok: false, message: "Choose a category for the agent." };
  }

  const { slugFromTitle } = await import("./audience");
  const base = slugFromTitle(title);
  if (!base) {
    return {
      ok: false,
      message: "Give the agent a name with some letters or numbers in it.",
    };
  }

  // A slug that collides with a registry id would make the merge
  // layer treat this row as an override of a code agent — the row
  // would take over that agent's identity and its conversations.
  // Refused rather than uniquified, because the admin means a
  // different agent and should pick a different name.
  if (PRACTICES.some((p) => p.id === base)) {
    return {
      ok: false,
      message:
        `"${base}" is the id of an agent that already exists in the code. ` +
        "Choose a different name.",
    };
  }

  const problem = validate(input.config);
  if (problem) return { ok: false, message: problem };

  const supabase = await db();

  // Uniquify against other database agents. The registry check above
  // is separate on purpose: that one refuses, this one adjusts,
  // because two admins naming two agents similarly is ordinary.
  const { data: taken } = await supabase
    .from("agents")
    .select("slug")
    .like("slug", `${base}%`);
  const used = new Set(((taken ?? []) as Array<{ slug: string }>).map((r) => r.slug));
  let slug = base;
  for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;

  const { data: last } = await supabase
    .from("agents")
    .select("sort_order")
    .eq("category_id", input.categoryId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const tail = (last ?? [])[0] as { sort_order: number } | undefined;

  const { data: agent, error } = await supabase
    .from("agents")
    .insert({
      slug,
      category_id: input.categoryId,
      title,
      description,
      sort_order: tail ? tail.sort_order + 1 : 0,
      allowed_roles: [...new Set(input.allowedRoles)],
      feature: input.feature || null,
      access_predicates: input.functionLead ? [FUNCTION_LEAD_PREDICATE] : [],
      created_by: session.profile.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !agent) {
    return { ok: false, message: "Couldn't create that agent." };
  }

  const inserted = await insertVersion(
    supabase,
    agent.id,
    input.config,
    "",
    session.profile.id
  );
  if ("error" in inserted) return { ok: false, message: inserted.error };

  const { error: pointerErr } = await supabase
    .from("agents")
    .update({ draft_version_id: inserted.id })
    .eq("id", agent.id);
  if (pointerErr) {
    return { ok: false, message: "Created the agent but couldn't attach its draft." };
  }

  refresh();
  return { ok: true, agentRowId: agent.id, slug };
}

// ---- Unpublish -------------------------------------------------
//
// The same pointer move as revertToCodeAction, and deliberately a
// different action with a different name: for a database-defined
// agent there is no code to revert TO, so calling it "revert to code
// default" would describe something that cannot happen.
//
// What it does: the agent leaves every picker and no new
// conversation can start on it. Conversations already running
// continue on their pinned versions, because those versions are
// immutable and nothing here touches them. That is the property the
// whole phase rests on.
export async function unpublishAgentAction(
  agentRowId: string
): Promise<VersionResult> {
  await requireRole(["system_admin"]);
  const supabase = await db();
  const { error } = await supabase
    .from("agents")
    .update({ live_version_id: null })
    .eq("id", agentRowId);
  if (error) return { ok: false, message: "Couldn't unpublish that agent." };
  refresh();
  return { ok: true };
}

// ---- Delete ----------------------------------------------------
//
// Only for an agent that was NEVER published and that no
// conversation references. Both are checked, because they can come
// apart: a version can have been live and then unpublished with no
// conversation ever started on it, and a conversation can exist on
// an agent whose live pointer was cleared.
//
// Everything else archives. Deleting an agent that conversations
// point at would leave rows whose practice_id names nothing, and
// those conversations would lose their name and their config.
export async function deleteAgentAction(
  agentRowId: string
): Promise<VersionResult> {
  await requireRole(["system_admin"]);
  const supabase = await db();

  const { data: agent } = await supabase
    .from("agents")
    .select("id, slug")
    .eq("id", agentRowId)
    .maybeSingle<{ id: string; slug: string }>();
  if (!agent) return { ok: false, message: "That agent no longer exists." };

  if (PRACTICES.some((p) => p.id === agent.slug)) {
    return {
      ok: false,
      message:
        "This agent is defined in the code, so it cannot be deleted here. Hide it instead.",
    };
  }

  const { count: published } = await supabase
    .from("agent_versions")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentRowId)
    .not("published_at", "is", null);
  if ((published ?? 0) > 0) {
    return {
      ok: false,
      message:
        "This agent has been published before, so it cannot be deleted. " +
        "Unpublish it to take it out of every picker: conversations that " +
        "already ran on it keep working, which is why the record has to stay.",
    };
  }

  const { count: used } = await supabase
    .from("coaching_conversations")
    .select("id", { count: "exact", head: true })
    .eq("practice_id", agent.slug);
  if ((used ?? 0) > 0) {
    return {
      ok: false,
      message:
        "Conversations have been started on this agent, so it cannot be " +
        "deleted. Hide it instead: the conversations keep working and keep " +
        "its name.",
    };
  }

  // Versions cascade with the row (0228's FK). Nothing was ever live
  // and nothing points at it, so there is no history to lose.
  const { error } = await supabase.from("agents").delete().eq("id", agentRowId);
  if (error) {
    return { ok: false, message: "Couldn't delete that agent." };
  }
  refresh();
  return { ok: true };
}
