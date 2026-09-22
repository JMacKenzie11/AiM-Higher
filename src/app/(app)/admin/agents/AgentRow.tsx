"use client";

import { useState } from "react";
import { COMPANY_FEATURES } from "@/lib/companies/features";
import {
  HUB_ROLE_OPTIONS,
  FUNCTION_LEAD_PREDICATE,
} from "@/lib/practices/hub-constants";
import type { HubAgent, HubCategory, HubCompany } from "@/lib/practices/hub-service";
import {
  moveAgentAction,
  moveAgentToCategoryAction,
  setAgentArchivedAction,
  updateAgentAccessAction,
  updateAgentIdentityAction,
  type HubResult,
} from "@/lib/practices/hub-actions";
import admin from "../companies/admin.module.css";
import styles from "./hub.module.css";

type Props = {
  agent: HubAgent;
  categories: HubCategory[];
  companies: HubCompany[];
  isFirst: boolean;
  isLast: boolean;
  pending: boolean;
  run: (fn: () => Promise<HubResult>) => void;
};

export function AgentRow({
  agent,
  categories,
  companies,
  isFirst,
  isLast,
  pending,
  run,
}: Props) {
  const [panel, setPanel] = useState<"none" | "identity" | "access">("none");

  // Local drafts so a half-typed name is not sent on every
  // keystroke. Re-seeded from props each time a panel is opened
  // rather than on every render, so a refresh landing mid-edit does
  // not wipe what is being typed, and re-opening never shows stale
  // text from a previous edit.
  const [title, setTitle] = useState(agent.title);
  const [description, setDescription] = useState(agent.description);
  const [roles, setRoles] = useState<string[]>(agent.allowedRoles);
  const [feature, setFeature] = useState<string>(agent.feature ?? "");
  const [functionLead, setFunctionLead] = useState(
    agent.accessPredicates.includes(FUNCTION_LEAD_PREDICATE)
  );
  const [allowlist, setAllowlist] = useState<string[]>(agent.companyAllowlist);

  function openIdentity() {
    setTitle(agent.title);
    setDescription(agent.description);
    setPanel(panel === "identity" ? "none" : "identity");
  }

  function openAccess() {
    setRoles(agent.allowedRoles);
    setFeature(agent.feature ?? "");
    setFunctionLead(agent.accessPredicates.includes(FUNCTION_LEAD_PREDICATE));
    setAllowlist(agent.companyAllowlist);
    setPanel(panel === "access" ? "none" : "access");
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
  }

  // A hidden feature stays selectable when it is the one already
  // set, so opening the editor on an agent gated by it and saving
  // anything else does not silently remove the gate.
  const featureOptions = COMPANY_FEATURES.filter(
    (f) => !f.hidden || f.value === agent.feature
  );

  return (
    <div
      className={`${styles.agentRow} ${
        agent.archived ? styles.agentRowArchived : ""
      }`}
      data-testid="agent-hub-agent-row"
      data-agent-slug={agent.slug}
    >
      <div className={styles.agentTop}>
        <div className={styles.agentMain}>
          <p className={styles.agentTitle}>{agent.title}</p>
          <p className={styles.agentDescription}>{agent.description}</p>
          <div className={styles.agentMeta}>
            <span className={styles.slug}>{agent.slug}</span>
            {agent.archived ? (
              <span className={styles.archivedChip}>Hidden</span>
            ) : null}
            {!agent.hasRegistryEntry ? (
              <span className={styles.warnChip}>
                No matching agent in the code. It will not appear to anyone.
              </span>
            ) : null}
            <span
              className={styles.accessChip}
              data-testid="agent-hub-access-summary"
            >
              {accessSummary(agent)}
            </span>
          </div>
        </div>

        <div className={styles.rowButtons}>
          <button
            type="button"
            className={styles.moveButton}
            onClick={() => run(() => moveAgentAction(agent.id, "up"))}
            disabled={pending || isFirst}
            aria-label={`Move ${agent.title} up`}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.moveButton}
            onClick={() => run(() => moveAgentAction(agent.id, "down"))}
            disabled={pending || isLast}
            aria-label={`Move ${agent.title} down`}
          >
            ↓
          </button>
          <button
            type="button"
            className={admin.ghostButton}
            onClick={openIdentity}
            disabled={pending}
            aria-expanded={panel === "identity"}
          >
            Edit
          </button>
          <button
            type="button"
            className={admin.ghostButton}
            onClick={openAccess}
            disabled={pending}
            aria-expanded={panel === "access"}
          >
            Access
          </button>
          <button
            type="button"
            className={admin.dangerGhost}
            onClick={() =>
              run(() => setAgentArchivedAction(agent.id, !agent.archived))
            }
            disabled={pending}
          >
            {agent.archived ? "Show again" : "Hide"}
          </button>
        </div>
      </div>

      {panel === "identity" ? (
        <div className={styles.panel}>
          <div className={admin.field}>
            <label className={admin.label} htmlFor={`title-${agent.id}`}>
              Name
            </label>
            <input
              id={`title-${agent.id}`}
              className={admin.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
            />
            <p className={admin.fieldHint}>
              The heading on the card in Ask Aimee.
            </p>
          </div>
          <div className={admin.field}>
            <label className={admin.label} htmlFor={`desc-${agent.id}`}>
              Description
            </label>
            <textarea
              id={`desc-${agent.id}`}
              className={admin.input}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={300}
            />
            <p className={admin.fieldHint}>
              One line under the name, saying what the agent helps with.
            </p>
          </div>
          <div className={admin.field}>
            <label className={admin.label} htmlFor={`cat-${agent.id}`}>
              Category
            </label>
            <select
              id={`cat-${agent.id}`}
              className={admin.select}
              value={agent.categoryId}
              onChange={(e) =>
                run(() => moveAgentToCategoryAction(agent.id, e.target.value))
              }
              disabled={pending}
            >
              {categories
                .filter((c) => !c.archived || c.id === agent.categoryId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <p className={admin.fieldHint}>
              Moving an agent puts it last in the new category. Applies as soon
              as you pick it.
            </p>
          </div>
          <div className={admin.submitRow}>
            <button
              type="button"
              className={admin.primaryButton}
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await updateAgentIdentityAction(agent.id, {
                    title,
                    description,
                  });
                  if (result.ok) setPanel("none");
                  return result;
                })
              }
            >
              Save
            </button>
            <button
              type="button"
              className={admin.ghostButton}
              onClick={() => setPanel("none")}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {panel === "access" ? (
        <div className={styles.panel}>
          <div className={styles.panelGrid}>
            <div className={admin.field}>
              <span className={admin.label}>Roles</span>
              <p className={admin.fieldHint}>
                Tick nothing to let every role use it. Ticking a role limits it
                to the roles you tick.
              </p>
              <div className={admin.checkGroup}>
                {HUB_ROLE_OPTIONS.map((r) => (
                  <label key={r.value} className={admin.checkOption}>
                    <input
                      type="checkbox"
                      checked={roles.includes(r.value)}
                      onChange={() => setRoles(toggle(roles, r.value))}
                    />
                    <span>
                      {r.label}
                      <br />
                      <span className={admin.fieldHint}>{r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <label className={admin.checkOption}>
                <input
                  type="checkbox"
                  checked={functionLead}
                  onChange={(e) => setFunctionLead(e.target.checked)}
                />
                <span>
                  Also anyone who leads a function
                  <br />
                  <span className={admin.fieldHint}>
                    Lets the person who runs a seat on the chart use it, even
                    when their role is not ticked above.
                  </span>
                </span>
              </label>
            </div>

            <div className={admin.field}>
              <label className={admin.label} htmlFor={`feature-${agent.id}`}>
                Feature
              </label>
              <select
                id={`feature-${agent.id}`}
                className={admin.select}
                value={feature}
                onChange={(e) => setFeature(e.target.value)}
              >
                <option value="">No feature needed</option>
                {featureOptions.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <p className={admin.fieldHint}>
                Choose a feature and only companies who have it can use the
                agent.
              </p>
            </div>

            <div className={admin.field}>
              <span className={admin.label}>Companies</span>
              <p className={admin.fieldHint}>
                Tick nothing for every company. Ticking a company limits the
                agent to the companies you tick, on top of the role and feature
                above.
              </p>
              <div className={styles.companyList}>
                {companies.length === 0 ? (
                  <p className={admin.fieldHint}>No companies yet.</p>
                ) : (
                  companies.map((c) => (
                    <label key={c.id} className={styles.companyOption}>
                      <input
                        type="checkbox"
                        checked={allowlist.includes(c.id)}
                        onChange={() => setAllowlist(toggle(allowlist, c.id))}
                      />
                      <span>{c.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className={admin.submitRow}>
            <button
              type="button"
              className={admin.primaryButton}
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await updateAgentAccessAction(agent.id, {
                    allowedRoles: roles,
                    feature: feature || null,
                    functionLead,
                    companyAllowlist: allowlist,
                  });
                  if (result.ok) setPanel("none");
                  return result;
                })
              }
            >
              Save
            </button>
            <button
              type="button"
              className={admin.ghostButton}
              onClick={() => setPanel("none")}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// The one-line "who can reach this" under each row, so the common
// question is answered without opening the editor.
function accessSummary(agent: HubAgent): string {
  const parts: string[] = [];
  if (agent.allowedRoles.length === 0) {
    parts.push("Everyone");
  } else {
    const labels = agent.allowedRoles.map(
      (r) => HUB_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r
    );
    parts.push(labels.join(", "));
  }
  if (agent.accessPredicates.includes(FUNCTION_LEAD_PREDICATE)) {
    parts.push("function leads");
  }
  if (agent.feature) {
    const label =
      COMPANY_FEATURES.find((f) => f.value === agent.feature)?.label ??
      agent.feature;
    parts.push(`needs ${label}`);
  }
  if (agent.companyAllowlist.length > 0) {
    parts.push(
      agent.companyAllowlist.length === 1
        ? "1 company"
        : `${agent.companyAllowlist.length} companies`
    );
  }
  return parts.join(" · ");
}
