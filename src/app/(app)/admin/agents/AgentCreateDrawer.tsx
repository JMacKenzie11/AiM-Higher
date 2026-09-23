"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "@/components/ui/Drawer";
import { COMPANY_FEATURES } from "@/lib/companies/features";
import { AGENT_MODEL_OPTIONS } from "@/lib/practices/models";
import {
  HUB_ROLE_OPTIONS,
  FUNCTION_LEAD_PREDICATE,
} from "@/lib/practices/hub-constants";
import { audienceSentence, slugFromTitle } from "@/lib/practices/audience";
import type { HubCategory } from "@/lib/practices/hub-service";
import {
  createAgentAction,
  type DraftInput,
  type VersionResult,
} from "@/lib/practices/version-actions";
import admin from "../companies/admin.module.css";
import styles from "./hub.module.css";

// Creating an agent, in three steps that match the three tabs an
// agent already has: identity, access, config.
//
// Nothing here is visible to anybody but a system admin when it
// finishes. Creating writes the row and a first DRAFT; the merge
// layer only offers a database-defined agent once it has a LIVE
// version, so "created" and "live" stay separate acts.

const STEPS = ["identity", "access", "config"] as const;
type Step = (typeof STEPS)[number];

const TOOL_OPTIONS = [
  { value: "get_foundation", label: "The company's Foundation" },
  { value: "list_functions", label: "The Functional Chart" },
  { value: "get_role_description", label: "A saved role description" },
] as const;

export function AgentCreateDrawer({
  categories,
  onClose,
}: {
  categories: HubCategory[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("identity");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [roles, setRoles] = useState<string[]>([]);
  const [feature, setFeature] = useState("");
  const [functionLead, setFunctionLead] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [chips, setChips] = useState("");
  const [basePromptMode, setBasePromptMode] =
    useState<DraftInput["basePromptMode"]>("full_coach");
  const [model, setModel] = useState("");
  const [tools, setTools] = useState<string[]>([]);

  // Stated on the last step, before the button that creates it, for
  // the same reason it is stated on every publish: access is three
  // controls on a different step by then.
  const audience = audienceSentence({
    allowedRoles: roles,
    accessPredicates: functionLead ? [FUNCTION_LEAD_PREDICATE] : [],
    feature: feature || null,
  });

  // What the first publish will need. Shown as it is filled rather
  // than as a refusal at the end.
  const missing: string[] = [];
  if (!title.trim()) missing.push("a name");
  if (!description.trim()) missing.push("a description");
  if (!categoryId) missing.push("a category");
  if (!prompt.trim()) missing.push("a prompt");

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result: VersionResult & { slug?: string } = await createAgentAction({
        title,
        description,
        categoryId,
        allowedRoles: roles,
        feature: feature || null,
        functionLead,
        config: {
          prompt,
          chips: chips.split("\n").map((c) => c.trim()).filter(Boolean),
          basePromptMode,
          skipSetup: false,
          firstTurn: null,
          scriptedOpener: null,
          outputCard: {},
          tools,
          maxTokens: null,
          model: model || null,
        },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <Drawer
      open
      onClose={onClose}
      name="agent-create"
      eyebrow={`Step ${stepIndex + 1} of 3`}
      title="New agent"
      footer={
        <>
          {stepIndex > 0 ? (
            <button
              type="button"
              className={admin.ghostButton}
              onClick={() => setStep(STEPS[stepIndex - 1])}
              disabled={busy}
            >
              Back
            </button>
          ) : null}
          {stepIndex < STEPS.length - 1 ? (
            <button
              type="button"
              className={admin.primaryButton}
              onClick={() => setStep(STEPS[stepIndex + 1])}
              disabled={busy}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className={admin.primaryButton}
              onClick={() => void create()}
              disabled={busy || missing.length > 0}
              data-testid="agent-create-submit"
            >
              Create as a draft
            </button>
          )}
          <button
            type="button"
            className={admin.ghostButton}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
        </>
      }
    >
      <div className={styles.drawerForm}>
        {error ? (
          <p className={admin.errorMessage} role="status" data-testid="agent-create-error">
            {error}
          </p>
        ) : null}

        <div className={styles.headActions}>
          {STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              className={s === step ? admin.primaryButton : admin.ghostButton}
              onClick={() => setStep(s)}
            >
              {i + 1}. {s === "config" ? "What it says" : s}
            </button>
          ))}
        </div>

        {step === "identity" ? (
          <>
            <div className={admin.field}>
              <label className={admin.label} htmlFor="new-title">
                Name
              </label>
              <input
                id="new-title"
                className={admin.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
              />
              {title.trim() ? (
                <p className={admin.fieldHint}>
                  Its permanent id will be{" "}
                  <code>{slugFromTitle(title) || "—"}</code>. That never
                  changes, even if you rename the agent later, because every
                  conversation ever run on it is filed under it.
                </p>
              ) : null}
            </div>

            <div className={admin.field}>
              <label className={admin.label} htmlFor="new-description">
                Description
              </label>
              <textarea
                id="new-description"
                className={`${admin.input} ${styles.startersEditor}`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={300}
              />
            </div>

            <div className={admin.field}>
              <label className={admin.label} htmlFor="new-category">
                Category
              </label>
              <select
                id="new-category"
                className={admin.select}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                {categories
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <p className={admin.fieldHint}>
                New agents go last in their category. Use the arrows on its
                row to move it up.
              </p>
            </div>
          </>
        ) : null}

        {step === "access" ? (
          <>
            <div className={admin.field}>
              <span className={admin.label}>Roles</span>
              <p className={admin.fieldHint}>
                Check nothing to let every role use it. Checking a role limits
                it to the roles you check.
              </p>
              <div className={admin.checkGroup}>
                {HUB_ROLE_OPTIONS.map((r) => (
                  <label key={r.value} className={admin.checkOption}>
                    <input
                      type="checkbox"
                      checked={roles.includes(r.value)}
                      onChange={() =>
                        setRoles(
                          roles.includes(r.value)
                            ? roles.filter((x) => x !== r.value)
                            : [...roles, r.value]
                        )
                      }
                    />
                    <span>{r.label}</span>
                  </label>
                ))}
                <label className={admin.checkOption}>
                  <input
                    type="checkbox"
                    checked={functionLead}
                    onChange={(e) => setFunctionLead(e.target.checked)}
                  />
                  <span>Functional Leads</span>
                </label>
              </div>
            </div>

            <div className={admin.field}>
              <label className={admin.label} htmlFor="new-feature">
                Feature
              </label>
              <select
                id="new-feature"
                className={admin.select}
                value={feature}
                onChange={(e) => setFeature(e.target.value)}
              >
                <option value="">No feature needed</option>
                {COMPANY_FEATURES.filter((f) => !f.hidden).map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        {step === "config" ? (
          <>
            <div className={admin.field}>
              <label className={admin.label} htmlFor="new-prompt">
                Prompt
              </label>
              <textarea
                id="new-prompt"
                className={`${admin.input} ${styles.promptEditor}`}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={14}
              />
              <p className={admin.fieldHint}>
                This is the agent. It decides what it asks, in what order, and
                what it produces.
              </p>
            </div>

            <div className={admin.field}>
              <label className={admin.label} htmlFor="new-chips">
                Conversation starters
              </label>
              <textarea
                id="new-chips"
                className={`${admin.input} ${styles.startersEditor}`}
                value={chips}
                onChange={(e) => setChips(e.target.value)}
                rows={4}
              />
              <p className={admin.fieldHint}>One per line.</p>
            </div>

            <div className={admin.field}>
              <label className={admin.label} htmlFor="new-base">
                Base prompt
              </label>
              <select
                id="new-base"
                className={admin.select}
                value={basePromptMode}
                onChange={(e) =>
                  setBasePromptMode(e.target.value as DraftInput["basePromptMode"])
                }
              >
                <option value="full_coach">
                  Full coach — coaching approach plus the AiMS voice
                </option>
                <option value="voice_only">
                  Voice only — the AiMS voice, nothing else
                </option>
              </select>
            </div>

            <div className={admin.field}>
              <label className={admin.label} htmlFor="new-model">
                Model
              </label>
              <select
                id="new-model"
                className={admin.select}
                value={model}
                onChange={(e) => setModel(e.target.value)}
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
              <span className={admin.label}>What it can look up</span>
              <div className={admin.checkGroup}>
                {TOOL_OPTIONS.map((t) => (
                  <label key={t.value} className={admin.checkOption}>
                    <input
                      type="checkbox"
                      checked={tools.includes(t.value)}
                      onChange={() =>
                        setTools(
                          tools.includes(t.value)
                            ? tools.filter((x) => x !== t.value)
                            : [...tools, t.value]
                        )
                      }
                    />
                    <span>{t.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <p className={styles.configSource} data-testid="agent-create-audience">
              {audience}
            </p>
            <p className={admin.fieldHint}>
              Creating saves it as a draft. Nobody can see it until you
              publish, and you should preview it first.
            </p>
            {missing.length > 0 ? (
              <p className={admin.fieldHint} data-testid="agent-create-missing">
                Still needed: {missing.join(", ")}.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
