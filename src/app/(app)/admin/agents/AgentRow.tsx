"use client";

import { COMPANY_FEATURES } from "@/lib/companies/features";
import {
  HUB_ROLE_OPTIONS,
  FUNCTION_LEAD_PREDICATE,
} from "@/lib/practices/hub-constants";
import type { HubAgent } from "@/lib/practices/hub-service";
import {
  moveAgentAction,
  setAgentArchivedAction,
  type HubResult,
} from "@/lib/practices/hub-actions";
import admin from "../companies/admin.module.css";
import styles from "./hub.module.css";

// One agent, as a row. Presentational apart from the two actions
// that belong to the row itself: reordering and archiving.
//
// Edit and Access open drawers owned by AgentHubEditor rather than
// panels owned here. Two reasons beyond consistency with the rest of
// the app: a drawer is one element on the page instead of one per
// row, and it unmounts on close, which seeds its form from props
// every time it opens rather than needing this component to
// remember to re-seed.

export function AgentRow({
  agent,
  isFirst,
  isLast,
  pending,
  run,
  onEdit,
  onAccess,
  onConfig,
  onDistribute,
}: {
  agent: HubAgent;
  isFirst: boolean;
  isLast: boolean;
  pending: boolean;
  run: (fn: () => Promise<HubResult>) => void;
  onEdit: () => void;
  onAccess: () => void;
  onConfig: () => void;
  onDistribute: () => void;
}) {
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
            {/* Phase 1 flagged "no matching agent in the code" as a
                fault, because back then it was one. Phase 3 makes it
                ordinary: an agent built in the Hub has no code by
                definition. What matters now is whether it has been
                published, so that is what the chip says. */}
            {agent.managedFrom ? (
              <span className={styles.accessChip}>
                Managed from AiMS HQ
              </span>
            ) : null}
            {!agent.managedFrom && !agent.hasRegistryEntry && !agent.liveVersionId ? (
              <span className={styles.warnChip}>
                Not published. Only system admins can see it.
              </span>
            ) : null}
            {!agent.managedFrom && !agent.hasRegistryEntry && agent.liveVersionId ? (
              <span className={styles.archivedChip}>Built in the Hub</span>
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
          {/* A managed agent is authored elsewhere. Every edit
              affordance is ABSENT rather than disabled: a disabled
              button invites someone to work out how to enable it,
              and there is no local answer. */}
          {agent.managedFrom ? (
            <span className={styles.agentDescription}>
              Edited on {agent.managedFrom}
            </span>
          ) : (
          <>
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
            onClick={onEdit}
            disabled={pending}
          >
            Edit
          </button>
          <button
            type="button"
            className={admin.ghostButton}
            onClick={onAccess}
            disabled={pending}
          >
            Access
          </button>
          <button
            type="button"
            className={admin.ghostButton}
            onClick={onConfig}
            disabled={pending}
          >
            Config
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
          {!agent.hasRegistryEntry ? (
            <button
              type="button"
              className={admin.ghostButton}
              onClick={onDistribute}
              disabled={pending}
              data-testid="agent-hub-distribute"
            >
              Distribute
            </button>
          ) : null}
          </>
          )}
        </div>
      </div>
    </div>
  );
}

// The one-line "who can reach this" under each row, so the common
// question is answered without opening the drawer.
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
    parts.push("Functional Leads");
  }
  if (agent.feature) {
    const label =
      COMPANY_FEATURES.find((f) => f.value === agent.feature)?.label ??
      agent.feature;
    parts.push(`needs ${label}`);
  }
  return parts.join(" · ");
}
