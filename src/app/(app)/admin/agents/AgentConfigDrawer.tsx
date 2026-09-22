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
import type { AgentConfigView, AgentVersionDetail } from "@/lib/practices/version-service";
import {
  discardDraftAction,
  loadAgentConfigAction,
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

const TOOL_OPTIONS = [
  "get_foundation",
  "list_functions",
  "get_role_description",
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
  pending: boolean;
  run: (fn: () => Promise<VersionResult>) => void;
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
  pending,
  run,
  onClose,
}: Props) {
  const router = useRouter();

  // Fetched on open rather than passed down: this carries prompt
  // text, and the Hub lists five agents. Loading all five prompts to
  // render one drawer would put every agent's wording in the page.
  const [config, setConfig] = useState<AgentConfigView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  }, [agentRowId]);

  const draft = config?.draft ?? null;
  const [view, setView] = useState<"config" | "publish" | "history">("config");
  const [notes, setNotes] = useState("");
  const [publishing, setPublishing] = useState<string | null>(null);

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
    : "the code default";

  const sourceLine = !config
    ? "Loading…"
    : config.liveSource === "version" && config.live
      ? `Running version ${config.live.versionNumber}` +
        (config.live.publishedByName ? `, published by ${config.live.publishedByName}` : "")
      : "Running the code default. Nothing has been published for this agent.";

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
              disabled={pending}
              onClick={() =>
                run(async () => {
                  return saveDraftAction(agentRowId, toDraftInput(form));
                })
              }
            >
              Save draft
            </button>
            <button
              type="button"
              className={admin.ghostButton}
              disabled={pending}
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
            disabled={pending}
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
              This agent&rsquo;s wording is set in the code. Editing it here
              copies that into a draft. Nothing changes for anyone until you
              publish.
            </p>
            <pre className={styles.promptPreview}>
              {config.live?.prompt ?? config.registry?.prompt ?? ""}
            </pre>
            <div className={styles.headActions}>
              <button
                type="button"
                className={admin.primaryButton}
                disabled={pending}
                data-testid="agent-config-edit-in-hub"
                onClick={() =>
                  run(async () => startDraftAction(agentRowId, slug))
                }
              >
                Edit in Hub
              </button>
              {config.liveSource === "version" && config.registry ? (
                <button
                  type="button"
                  className={admin.dangerGhost}
                  disabled={pending}
                  onClick={() =>
                    run(async () => revertToCodeAction(agentRowId))
                  }
                >
                  Revert to code default
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
                Opening chips
              </label>
              <textarea
                id="cfg-chips"
                className={admin.input}
                value={form.chips.join("\n")}
                onChange={(e) =>
                  set(
                    "chips",
                    e.target.value.split("\n").map((c) => c.trim()).filter(Boolean)
                  )
                }
                rows={3}
              />
              <p className={admin.fieldHint}>One per line.</p>
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
                <option value="full_coach">Full coach</option>
                <option value="voice_only">Voice only</option>
              </select>
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
              <span className={admin.label}>Tools</span>
              <div className={admin.checkGroup}>
                {TOOL_OPTIONS.map((t) => (
                  <label key={t} className={admin.checkOption}>
                    <input
                      type="checkbox"
                      checked={form.tools.includes(t)}
                      onChange={() =>
                        set(
                          "tools",
                          form.tools.includes(t)
                            ? form.tools.filter((x) => x !== t)
                            : [...form.tools, t]
                        )
                      }
                    />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className={admin.field}>
              <span className={admin.label}>Output cards</span>
              <p className={admin.fieldHint}>
                Fenced tag on the left, card on the right. Only cards this
                build ships can be chosen.
              </p>
              {Object.entries(form.outputCard).map(([tag, card]) => (
                <div key={tag} className={styles.addRow}>
                  <input
                    className={admin.input}
                    value={tag}
                    readOnly
                    aria-label={`Fenced tag ${tag}`}
                  />
                  <select
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
                disabled={pending}
                data-testid="agent-config-preview"
                onClick={() =>
                  run(async () => {
                    const r = await startPreviewAction(
                      agentRowId,
                      slug,
                      draft.id
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
                disabled={pending}
                data-testid="agent-config-discard"
                onClick={() => run(async () => discardDraftAction(agentRowId))}
              >
                Discard draft
              </button>
            </div>
          </>
        ) : null}

        {/* ---- publish: the diff, then the notes ---- */}
        {view === "publish" && draft && form && baseline ? (
          <div data-testid="agent-config-diff">
            <p className={admin.fieldHint}>
              Comparing this draft against {baselineLabel}.
            </p>

            {fieldChanges(baseline, form).length === 0 &&
            baseline.prompt === form.prompt ? (
              <p className={admin.emptyLine}>
                Nothing has changed against {baselineLabel}.
              </p>
            ) : null}

            {fieldChanges(baseline, form).map((c) => (
              <p key={c.label} className={styles.diffField}>
                <strong>{c.label}</strong>: {c.before} → {c.after}
              </p>
            ))}

            {baseline.prompt !== form.prompt ? (
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
                disabled={pending || !notes.trim()}
                data-testid="agent-config-publish"
                onClick={() =>
                  run(async () => {
                    const saved = await saveDraftAction(agentRowId, toDraftInput(form));
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
                disabled={pending}
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
                          disabled={pending || !notes.trim()}
                          onClick={() =>
                            run(async () => {
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
                        disabled={pending}
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
