"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "@/components/ui/Drawer";
import { AGENT_MODEL_OPTIONS } from "@/lib/practices/models";
import {
  collapseUnchanged,
  fieldChanges,
  promptDiff,
  type ConfigShape,
} from "@/lib/practices/config-diff";
import { audienceSentence } from "@/lib/practices/audience";
import type { AgentConfigView, AgentVersionDetail } from "@/lib/practices/version-service";
import {
  deleteAgentAction,
  discardDraftAction,
  loadAgentConfigAction,
  unpublishAgentAction,
  publishDraftAction,
  revertToCodeAction,
  saveDraftAction,
  startDraftAction,
  startPreviewAction,
  type DraftInput,
  type VersionResult,
} from "@/lib/practices/version-actions";
import admin from "../companies/admin.module.css";
import styles from "./hub.module.css";

// The three read-only lookups an agent may be given. Labelled for a
// human: the raw function names told a system admin nothing about
// what switching one on actually does.
const TOOL_OPTIONS = [
  {
    value: "get_foundation",
    label: "The company's Foundation",
    hint: "Purpose, values and the rest of the Foundation page.",
  },
  {
    value: "list_functions",
    label: "The Functional Chart",
    hint: "The seats on the chart and who leads them.",
  },
  {
    value: "get_role_description",
    label: "A saved role description",
    hint: "Only used when the conversation is revising one.",
  },
] as const;
const CARD_OPTIONS = [
  "ScriptCard",
  "ChartProposalCard",
  "RoleDescriptionCard",
] as const;

// ConfigShape keeps its string fields loose so the diff can compare
// anything; DraftInput is the narrow shape the action accepts. This
// is the one place they meet.
function toDraftInput(f: ConfigShape): DraftInput {
  return {
    ...f,
    basePromptMode:
      f.basePromptMode === "voice_only" ? "voice_only" : "full_coach",
    firstTurn:
      f.firstTurn === "scripted" || f.firstTurn === "generate"
        ? f.firstTurn
        : null,
  };
}

type Props = {
  agentRowId: string;
  slug: string;
  title: string;
  // Phase 3: an agent with no code behind it gets Unpublish and
  // (while it has never been published) Delete, instead of "revert
  // to code default" — there is no code to revert to.
  hasRegistryEntry: boolean;
  access: {
    allowedRoles: string[];
    accessPredicates: string[];
    feature: string | null;
  };
  pending: boolean;
  onClose: () => void;
};

function shapeOf(v: AgentVersionDetail): ConfigShape {
  return {
    prompt: v.prompt,
    chips: v.chips,
    basePromptMode: v.basePromptMode,
    skipSetup: v.skipSetup,
    firstTurn: v.firstTurn,
    scriptedOpener: v.scriptedOpener,
    outputCard: v.outputCard,
    tools: v.tools,
    maxTokens: v.maxTokens,
    model: v.model,
  };
}

export function AgentConfigDrawer({
  agentRowId,
  slug,
  title,
  hasRegistryEntry,
  access,
  pending,
  onClose,
}: Props) {
  const router = useRouter();

  // Fetched on open rather than passed down: this carries prompt
  // text, and the Hub lists five agents. Loading all five prompts to
  // render one drawer would put every agent's wording in the page.
  const [config, setConfig] = useState<AgentConfigView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped after every action, because this drawer owns its own
  // data. router.refresh() re-renders the PAGE; it does not re-run
  // an effect in a component whose props did not change, so without
  // this the drawer kept showing the config it fetched on open —
  // "Edit in Hub" appeared to do nothing at all.
  const [reloadKey, setReloadKey] = useState(0);
  // "Saved" paints only once the REFETCH has landed, never when the
  // action returns.
  //
  // The first version of this set a flag the moment saveDraftAction
  // resolved, which made it a lie: the drawer's own copy of the
  // draft lags a save by one refetch, so the indicator said "saved"
  // while the form on screen was still pointed at the previous
  // version. A test that waited on it still raced, and an admin
  // reading it would have been told the same untruth.
  //
  // So it is derived from evidence instead. A save inserts a NEW
  // version and moves the draft pointer, so the proof that the
  // refetch caught up is that the draft's id CHANGED from the one we
  // saved out of. Until that happens, nothing is claimed.
  const [savedFrom, setSavedFrom] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    loadAgentConfigAction(agentRowId).then((r) => {
      if (!live) return;
      if (r.ok) setConfig(r.view);
      else setLoadError(r.message);
    });
    return () => {
      live = false;
    };
  }, [agentRowId, reloadKey]);

  // Every write in this drawer goes through here: run it, surface a
  // refusal as written, then refetch. router.refresh() still fires
  // so the row behind the drawer picks up anything that changed
  // there too.
  async function act(fn: () => Promise<VersionResult>): Promise<VersionResult> {
    setBusy(true);
    setLoadError(null);
    try {
      const result = await fn();
      if (!result.ok) {
        setLoadError(result.message);
      } else {
        setReloadKey((k) => k + 1);
        router.refresh();
      }
      return result;
    } finally {
      setBusy(false);
    }
  }

  const draft = config?.draft ?? null;
  const [view, setView] = useState<"config" | "publish" | "history">("config");
  const [notes, setNotes] = useState("");
  const [publishing, setPublishing] = useState<string | null>(null);
  // Which history entry is showing its diff against what is live.
  const [diffing, setDiffing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"unpublish" | "delete" | null>(null);

  // The draft form. Seeded once; the drawer unmounts on close, so
  // reopening re-seeds from whatever was saved.
  const [form, setForm] = useState<ConfigShape | null>(null);
  // Seeded when the fetch lands, and keyed on the draft's ID so it
  // re-seeds after a save (which supersedes the draft with a new
  // row) but NOT on every render, which would discard what is being
  // typed. `draft` itself is deliberately not a dependency: it is a
  // fresh object each fetch, so depending on it would re-seed
  // constantly.
  const draftId = draft?.id ?? null;
  useEffect(() => {
    if (draft) setForm(shapeOf(draft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // The evidence the save landed: the refetched draft is a different
  // row from the one we saved out of.
  useEffect(() => {
    if (savedFrom && draftId && draftId !== savedFrom) {
      setSaved(true);
      setSavedFrom(null);
    }
  }, [draftId, savedFrom]);

  function set<K extends keyof ConfigShape>(key: K, value: ConfigShape[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  // What the draft is being compared against: the live version if
  // there is one, otherwise the code registry. Stated on screen so
  // nobody reads a diff against the wrong thing.
  const baseline: ConfigShape | null = !config
    ? null
    : config.live
    ? shapeOf(config.live)
    : config.registry
      ? {
          prompt: config.registry.prompt,
          chips: [...config.registry.chips],
          basePromptMode: config.registry.basePromptMode,
          skipSetup: config.registry.skipSetup,
          firstTurn: config.registry.firstTurn,
          scriptedOpener: config.registry.scriptedOpener,
          outputCard: { ...(config.registry.outputCard ?? {}) },
          tools: [...config.registry.tools],
          maxTokens: config.registry.maxTokens,
          model: config.registry.model,
        }
      : null;

  const baselineLabel = config?.live
    ? `version ${config.live.versionNumber}, which is live now`
    : config?.registry
      ? "the code default"
      : // A net-new agent's first publish has nothing to compare
        // against: no live version and no code entry. The panel
        // renders the whole config instead of a diff, which is the
        // honest thing to show somebody about to publish it.
        "nothing yet — this is the first version";

  const sourceLine = !config
    ? "Loading…"
    : config.liveSource === "version" && config.live
      ? `Running version ${config.live.versionNumber}` +
        (config.live.publishedByName
          ? `, published by ${config.live.publishedByName}`
          : "")
      : hasRegistryEntry
        ? "Running the code default. Nothing has been published for this agent."
        : // A Hub-built agent has no code default to fall back to,
          // so saying it is "running" one would be false. It is
          // simply not published, and nobody can see it.
          "Not published. Only system admins can see this agent, and no conversation can start on it.";

  return (
    <Drawer
      open
      onClose={onClose}
      name="agent-config"
      eyebrow="Configuration"
      title={title}
      footer={
        view === "config" && form ? (
          <>
            <button
              type="button"
              className={admin.primaryButton}
              disabled={pending || busy}
              onClick={() =>
                void act(async () => {
                  setSaved(false);
                  setSavedFrom(draft?.id ?? null);
                  return saveDraftAction(agentRowId, toDraftInput(form));
                })
              }
            >
              Save draft
            </button>
            <button
              type="button"
              className={admin.ghostButton}
              disabled={pending || busy}
              onClick={() => setView("publish")}
            >
              Review and publish
            </button>
          </>
        ) : (
          <button
            type="button"
            className={admin.ghostButton}
            onClick={onClose}
            disabled={pending || busy}
          >
            Close
          </button>
        )
      }
    >
      <div className={styles.drawerForm}>
        <p className={styles.configSource} data-testid="agent-config-source">
          {sourceLine}
        </p>
        {confirm === "unpublish" ? (
          <div className={admin.warningMessage} data-testid="agent-config-confirm-unpublish">
            <p>
              Unpublishing takes this agent out of every picker and stops any
              new conversation starting on it. Conversations already running
              carry on exactly as they are, on the version they started with.
              You can publish it again at any time.
            </p>
            <div className={styles.headActions}>
              <button
                type="button"
                className={admin.dangerButton}
                disabled={busy}
                data-testid="agent-config-confirm-unpublish-accept"
                onClick={() =>
                  void act(async () => {
                    const r = await unpublishAgentAction(agentRowId);
                    if (r.ok) setConfirm(null);
                    return r;
                  })
                }
              >
                Unpublish
              </button>
              <button
                type="button"
                className={admin.ghostButton}
                onClick={() => setConfirm(null)}
                disabled={busy}
              >
                Keep it published
              </button>
            </div>
          </div>
        ) : null}

        {confirm === "delete" ? (
          <div className={admin.warningMessage} data-testid="agent-config-confirm-delete">
            <p>
              Deleting removes this agent and every draft of it for good.
              That is only possible because it has never been published, so
              no conversation has ever run on it. Once an agent has been
              published it can only be unpublished or hidden: the record has
              to stay, or the conversations that used it would lose their
              name and their wording.
            </p>
            <div className={styles.headActions}>
              <button
                type="button"
                className={admin.dangerButton}
                disabled={busy}
                data-testid="agent-config-confirm-delete-accept"
                onClick={() =>
                  void act(async () => {
                    const r = await deleteAgentAction(agentRowId);
                    if (r.ok) onClose();
                    return r;
                  })
                }
              >
                Delete for good
              </button>
              <button
                type="button"
                className={admin.ghostButton}
                onClick={() => setConfirm(null)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {loadError ? (
          <p className={admin.errorMessage} role="status">
            {loadError}
          </p>
        ) : null}

        <div className={styles.headActions}>
          <button
            type="button"
            className={view === "config" ? admin.primaryButton : admin.ghostButton}
            onClick={() => setView("config")}
          >
            Config
          </button>
          <button
            type="button"
            className={view === "history" ? admin.primaryButton : admin.ghostButton}
            onClick={() => setView("history")}
          >
            History ({config?.history.length ?? 0})
          </button>
        </div>

        {/* ---- no draft: read-only, and one way in ---- */}
        {view === "config" && config && !draft ? (
          <>
            <p className={admin.fieldHint}>
              {hasRegistryEntry
                ? "This agent's wording is set in the code. Editing it here copies that into a draft. Nothing changes for anyone until you publish."
                : "This agent was built here. Editing starts a new draft from the version that is live now. Nothing changes for anyone until you publish."}
            </p>
            <pre className={styles.promptPreview}>
              {config.live?.prompt ?? config.registry?.prompt ?? ""}
            </pre>
            <div className={styles.headActions}>
              <button
                type="button"
                className={admin.primaryButton}
                disabled={pending || busy}
                data-testid="agent-config-edit-in-hub"
                onClick={() =>
                  void act(() => startDraftAction(agentRowId, slug))
                }
              >
                Edit in Hub
              </button>
              {hasRegistryEntry && config.liveSource === "version" ? (
                <button
                  type="button"
                  className={admin.dangerGhost}
                  disabled={pending || busy}
                  onClick={() => void act(() => revertToCodeAction(agentRowId))}
                >
                  Revert to code default
                </button>
              ) : null}

              {!hasRegistryEntry && config.liveSource === "version" ? (
                <button
                  type="button"
                  className={admin.dangerGhost}
                  disabled={pending || busy}
                  data-testid="agent-config-unpublish"
                  onClick={() => setConfirm("unpublish")}
                >
                  Unpublish
                </button>
              ) : null}

              {!hasRegistryEntry && !config.everPublished ? (
                <button
                  type="button"
                  className={admin.dangerGhost}
                  disabled={pending || busy}
                  data-testid="agent-config-delete"
                  onClick={() => setConfirm("delete")}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {/* ---- the draft editor ---- */}
        {view === "config" && draft && form ? (
          <>
            <p className={admin.fieldHint} data-testid="agent-config-draft-note">
              Draft, version {draft.versionNumber}. Not live. Save keeps
              working on it; publish sends it to every company.
            </p>
            {saved ? (
              <p
                className={admin.successMessage}
                role="status"
                data-testid="agent-config-saved"
              >
                Saved as version {draft.versionNumber}. Preview and Publish
                save again first, so both always use what is on screen.
              </p>
            ) : null}

            <div className={admin.field}>
              <label className={admin.label} htmlFor="cfg-prompt">
                Prompt
              </label>
              <textarea
                id="cfg-prompt"
                className={`${admin.input} ${styles.promptEditor}`}
                value={form.prompt}
                onChange={(e) => set("prompt", e.target.value)}
                rows={18}
              />
            </div>

            <div className={admin.field}>
              <label className={admin.label} htmlFor="cfg-chips">
                Conversation starters
              </label>
              <textarea
                id="cfg-chips"
                className={`${admin.input} ${styles.startersEditor}`}
                value={form.chips.join("\n")}
                onChange={(e) =>
                  set(
                    "chips",
                    e.target.value.split("\n").map((c) => c.trim()).filter(Boolean)
                  )
                }
                rows={5}
              />
              <p className={admin.fieldHint}>
                One per line. These are the buttons someone can press instead
                of typing, on the empty chat.
              </p>
            </div>

            <div className={admin.field}>
              <label className={admin.label} htmlFor="cfg-base">
                Base prompt
              </label>
              <select
                id="cfg-base"
                className={admin.select}
                value={form.basePromptMode}
                onChange={(e) => set("basePromptMode", e.target.value)}
              >
                <option value="full_coach">
                  Full coach — coaching approach plus the AiMS voice
                </option>
                <option value="voice_only">
                  Voice only — the AiMS voice, nothing else
                </option>
              </select>
              <p className={admin.fieldHint}>
                What sits underneath the prompt above. Choose{" "}
                <strong>Full coach</strong> for an agent that holds a
                conversation, so it inherits how a coach listens and asks.
                Choose <strong>Voice only</strong> for an agent that runs a
                structured task, where the prompt above is the whole flow and
                the coaching approach would pull it into diagnosis instead.
              </p>
            </div>

            <div className={admin.field}>
              <label className={admin.label} htmlFor="cfg-model">
                Model
              </label>
              <select
                id="cfg-model"
                className={admin.select}
                value={form.model ?? ""}
                onChange={(e) => set("model", e.target.value || null)}
              >
                <option value="">Platform default</option>
                {AGENT_MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={admin.field}>
              <label className={admin.label} htmlFor="cfg-tokens">
                Token ceiling
              </label>
              <input
                id="cfg-tokens"
                className={admin.input}
                type="number"
                min={256}
                max={32000}
                value={form.maxTokens ?? ""}
                onChange={(e) =>
                  set("maxTokens", e.target.value ? Number(e.target.value) : null)
                }
              />
              <p className={admin.fieldHint}>
                Blank uses the route default. Raise it for an agent that emits
                a document.
              </p>
            </div>

            <div className={admin.field}>
              <span className={admin.label}>What it can look up</span>
              <p className={admin.fieldHint}>
                Company information the agent may read mid-conversation. It
                only ever reads, only this company, and only what the person
                it is talking to could already see.
              </p>
              <div className={admin.checkGroup}>
                {TOOL_OPTIONS.map((t) => (
                  <label key={t.value} className={admin.checkOption}>
                    <input
                      type="checkbox"
                      checked={form.tools.includes(t.value)}
                      onChange={() =>
                        set(
                          "tools",
                          form.tools.includes(t.value)
                            ? form.tools.filter((x) => x !== t.value)
                            : [...form.tools, t.value]
                        )
                      }
                    />
                    <span>
                      {t.label}
                      <br />
                      <span className={admin.fieldHint}>{t.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className={admin.field}>
              <span className={admin.label}>Formatted results</span>
              <p className={admin.fieldHint}>
                Some agents finish by producing something structured, like a
                script or a draft role description, and it is shown as a
                formatted card instead of plain text. Each pair below says:
                when the agent marks part of its reply with this label, show
                it as this card.
              </p>
              {Object.entries(form.outputCard).map(([tag, card]) => (
                <div key={tag} className={styles.cardPair}>
                  <label className={admin.fieldHint} htmlFor={`tag-${tag}`}>
                    Label the agent writes
                  </label>
                  <input
                    id={`tag-${tag}`}
                    className={admin.input}
                    value={tag}
                    readOnly
                    aria-label={`Label the agent writes: ${tag}`}
                  />
                  <label className={admin.fieldHint} htmlFor={`card-${tag}`}>
                    Shown as
                  </label>
                  <select
                    id={`card-${tag}`}
                    className={admin.select}
                    value={card}
                    aria-label={`Card for ${tag}`}
                    onChange={(e) =>
                      set("outputCard", { ...form.outputCard, [tag]: e.target.value })
                    }
                  >
                    {CARD_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={admin.dangerGhost}
                    onClick={() => {
                      const next = { ...form.outputCard };
                      delete next[tag];
                      set("outputCard", next);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className={styles.headActions}>
              <button
                type="button"
                className={admin.ghostButton}
                disabled={pending || busy}
                data-testid="agent-config-preview"
                onClick={() =>
                  void act(async () => {
                    // SAVE FIRST, then preview the version just
                    // written. Previewing `draft.id` meant previewing
                    // the last SAVED state, not what is on screen —
                    // and worse, the drawer's own copy of the draft
                    // lags a save by one refetch, so pressing Save
                    // then Preview previewed the version from before
                    // the save. Publish already works this way; so
                    // should this, and for the same reason: what you
                    // are looking at is what should run.
                    const saved = await saveDraftAction(
                      agentRowId,
                      toDraftInput(form)
                    );
                    if (!saved.ok) return saved;
                    const r = await startPreviewAction(
                      agentRowId,
                      slug,
                      saved.versionId!
                    );
                    if (r.ok && r.conversationId) {
                      router.push(`/ask-aimee/${r.conversationId}`);
                    }
                    return r;
                  })
                }
              >
                Preview this draft
              </button>
              <button
                type="button"
                className={admin.dangerGhost}
                disabled={pending || busy}
                data-testid="agent-config-discard"
                onClick={() => void act(() => discardDraftAction(agentRowId))}
              >
                Discard draft
              </button>
            </div>
          </>
        ) : null}

        {/* ---- publish: the diff, then the notes ---- */}
        {view === "publish" && draft && form ? (
          <div data-testid="agent-config-diff">
            <p className={admin.fieldHint}>
              {baseline
                ? `Comparing this draft against ${baselineLabel}.`
                : "This is the first version of this agent, so there is nothing to compare it against. The whole configuration is below."}
            </p>

            {baseline &&
            fieldChanges(baseline, form).length === 0 &&
            baseline.prompt === form.prompt ? (
              <p className={admin.emptyLine}>
                Nothing has changed against {baselineLabel}.
              </p>
            ) : null}

            {baseline
              ? fieldChanges(baseline, form).map((c) => (
                  <p key={c.label} className={styles.diffField}>
                    <strong>{c.label}</strong>: {c.before} → {c.after}
                  </p>
                ))
              : null}

            {!baseline ? (
              <>
                <p className={styles.diffField}>
                  <strong>Conversation starters</strong>:{" "}
                  {form.chips.length ? form.chips.join(", ") : "none"}
                </p>
                <p className={styles.diffField}>
                  <strong>Base prompt</strong>: {form.basePromptMode}
                </p>
                <p className={styles.diffField}>
                  <strong>Model</strong>: {form.model ?? "platform default"}
                </p>
                <p className={styles.diffField}>
                  <strong>Token ceiling</strong>:{" "}
                  {form.maxTokens ?? "route default"}
                </p>
                <p className={styles.diffField}>
                  <strong>What it can look up</strong>:{" "}
                  {form.tools.length ? form.tools.join(", ") : "nothing"}
                </p>
                <pre className={styles.diffPrompt}>{form.prompt}</pre>
              </>
            ) : null}

            {baseline && baseline.prompt !== form.prompt ? (
              <pre className={styles.diffPrompt}>
                {collapseUnchanged(promptDiff(baseline.prompt, form.prompt)).map(
                  (l, i) => (
                    <span
                      key={i}
                      className={
                        l.kind === "added"
                          ? styles.diffAdded
                          : l.kind === "removed"
                            ? styles.diffRemoved
                            : l.kind === "gap"
                              ? styles.diffGap
                              : undefined
                      }
                    >
                      {l.kind === "added"
                        ? "+ "
                        : l.kind === "removed"
                          ? "- "
                          : l.kind === "gap"
                            ? "  … "
                            : "  "}
                      {l.text}
                      {"\n"}
                    </span>
                  )
                )}
              </pre>
            ) : null}

            <p
              className={styles.configSource}
              data-testid="agent-config-audience"
            >
              {audienceSentence(access)}
            </p>

            <div className={admin.field}>
              <label className={admin.label} htmlFor="cfg-notes">
                Publish notes
              </label>
              <textarea
                id="cfg-notes"
                className={admin.input}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
              <p className={admin.fieldHint}>
                Required. This is the commit message for a change to what
                every company&rsquo;s agent says.
              </p>
            </div>

            <div className={styles.headActions}>
              <button
                type="button"
                className={admin.primaryButton}
                disabled={pending || busy || !notes.trim()}
                data-testid="agent-config-publish"
                onClick={() =>
                  void act(async () => {
                    const saved = await saveDraftAction(
                      agentRowId,
                      toDraftInput(form)
                    );
                    if (!saved.ok) return saved;
                    const r = await publishDraftAction(
                      agentRowId,
                      saved.versionId!,
                      notes
                    );
                    if (r.ok) {
                      setNotes("");
                      setView("config");
                    }
                    return r;
                  })
                }
              >
                Publish
              </button>
              <button
                type="button"
                className={admin.ghostButton}
                onClick={() => setView("config")}
                disabled={pending || busy}
              >
                Back
              </button>
            </div>
          </div>
        ) : null}

        {/* ---- history ---- */}
        {view === "history" && config ? (
          <div data-testid="agent-config-history">
            {config.history.length === 0 ? (
              <p className={admin.emptyLine}>No versions yet.</p>
            ) : (
              config.history.map((v) => (
                <div key={v.id} className={styles.versionRow}>
                  <p className={styles.agentTitle}>
                    Version {v.versionNumber}
                    {v.isLive ? " · live" : ""}
                    {v.isDraft ? " · draft" : ""}
                  </p>
                  <p className={styles.agentDescription}>
                    {v.publishedAt
                      ? new Date(v.publishedAt).toLocaleDateString()
                      : "unpublished"}
                    {v.publishedByName ? ` · ${v.publishedByName}` : ""}
                  </p>
                  {v.publishNotes ? (
                    <p className={styles.agentDescription}>{v.publishNotes}</p>
                  ) : null}
                  {!v.isLive && baseline ? (
                    <button
                      type="button"
                      className={admin.inlineEditButton}
                      onClick={() => setDiffing(diffing === v.id ? null : v.id)}
                    >
                      {diffing === v.id ? "Hide diff" : "View diff"}
                    </button>
                  ) : null}
                  {diffing === v.id && baseline ? (
                    <pre className={styles.diffPrompt}>
                      {fieldChanges(baseline, shapeOf(v)).map((c) => (
                        <span key={c.label} className={styles.diffField}>
                          {c.label}: {c.before} → {c.after}
                          {"\n"}
                        </span>
                      ))}
                      {collapseUnchanged(
                        promptDiff(baseline.prompt, v.prompt)
                      ).map((l, i) => (
                        <span
                          key={i}
                          className={
                            l.kind === "added"
                              ? styles.diffAdded
                              : l.kind === "removed"
                                ? styles.diffRemoved
                                : l.kind === "gap"
                                  ? styles.diffGap
                                  : undefined
                          }
                        >
                          {l.kind === "added"
                            ? "+ "
                            : l.kind === "removed"
                              ? "- "
                              : l.kind === "gap"
                                ? "  … "
                                : "  "}
                          {l.text}
                          {"\n"}
                        </span>
                      ))}
                    </pre>
                  ) : null}
                  {!v.isLive ? (
                    publishing === v.id ? (
                      <div className={styles.addRow}>
                        <input
                          className={admin.input}
                          placeholder="Why are you rolling back?"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          aria-label="Rollback notes"
                        />
                        <button
                          type="button"
                          className={admin.primaryButton}
                          disabled={pending || busy || !notes.trim()}
                          onClick={() =>
                            void act(async () => {
                              const r = await publishDraftAction(
                                agentRowId,
                                v.id,
                                notes
                              );
                              if (r.ok) {
                                setNotes("");
                                setPublishing(null);
                              }
                              return r;
                            })
                          }
                        >
                          Make live
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={admin.ghostButton}
                        onClick={() => setPublishing(v.id)}
                        disabled={pending || busy}
                      >
                        Make live
                      </button>
                    )
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
