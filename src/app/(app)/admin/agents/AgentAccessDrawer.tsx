"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { COMPANY_FEATURES } from "@/lib/companies/features";
import {
  HUB_ROLE_OPTIONS,
  FUNCTION_LEAD_PREDICATE,
} from "@/lib/practices/hub-constants";
import type { HubAgent } from "@/lib/practices/hub-service";
import {
  updateAgentAccessAction,
  type HubResult,
} from "@/lib/practices/hub-actions";
import admin from "../companies/admin.module.css";
import styles from "./hub.module.css";

// Who can reach an agent: roles, Functional Leads, and a feature.
// Its own drawer rather than a tab inside the edit one, because the
// two answer different questions and are reached from different
// buttons on the row.

export function AgentAccessDrawer({
  agent,
  pending,
  run,
  onClose,
}: {
  agent: HubAgent;
  pending: boolean;
  run: (fn: () => Promise<HubResult>) => void;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState<string[]>(agent.allowedRoles);
  const [feature, setFeature] = useState<string>(agent.feature ?? "");
  const [functionLead, setFunctionLead] = useState(
    agent.accessPredicates.includes(FUNCTION_LEAD_PREDICATE)
  );

  // A hidden feature stays selectable when it is the one already
  // set, so opening this drawer on an agent gated by it and saving
  // anything else does not silently remove the gate.
  const featureOptions = COMPANY_FEATURES.filter(
    (f) => !f.hidden || f.value === agent.feature
  );

  function toggle(list: string[], value: string): string[] {
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
  }

  function save() {
    run(async () => {
      const result = await updateAgentAccessAction(agent.id, {
        allowedRoles: roles,
        feature: feature || null,
        functionLead,
      });
      if (result.ok) onClose();
      return result;
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      name="agent-access"
      eyebrow="Who can reach it"
      title={agent.title}
      footer={
        <>
          <button
            type="button"
            className={admin.primaryButton}
            onClick={save}
            disabled={pending}
          >
            Save
          </button>
          <button
            type="button"
            className={admin.ghostButton}
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
        </>
      }
    >
      <div className={styles.drawerForm}>
        <div className={admin.field}>
          <span className={admin.label}>Roles</span>
          <p className={admin.fieldHint}>
            Check nothing to let every role use it. Checking a role limits it
            to the roles you check.
          </p>
          <div className={admin.checkGroup}>
            {HUB_ROLE_OPTIONS.map((r) => (
              <label key={r.value} className={admin.checkOption}>
                <input
                  type="checkbox"
                  checked={roles.includes(r.value)}
                  onChange={() => setRoles(toggle(roles, r.value))}
                />
                <span>{r.label}</span>
              </label>
            ))}
            {/* In the same group as the roles, and flowing with
                them. Not a platform role — it is a relationship the
                chart decides — but it is the same question asked the
                same way, and a row of its own gave it a weight the
                control does not carry. */}
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
          <label className={admin.label} htmlFor="agent-feature">
            Feature
          </label>
          <select
            id="agent-feature"
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
            Choose a feature and only companies who have it can use the agent.
          </p>
        </div>
      </div>
    </Drawer>
  );
}
