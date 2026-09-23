"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { HubAgent, HubCategory } from "@/lib/practices/hub-service";
import {
  createHubCategoryAction,
  moveHubCategoryAction,
  renameHubCategoryAction,
  setHubCategoryArchivedAction,
  type HubResult,
} from "@/lib/practices/hub-actions";
import { AgentRow } from "./AgentRow";
import { AgentEditDrawer } from "./AgentEditDrawer";
import { AgentAccessDrawer } from "./AgentAccessDrawer";
import { AgentConfigDrawer } from "./AgentConfigDrawer";
import { AgentCreateDrawer } from "./AgentCreateDrawer";
import { AgentDistributionDrawer } from "./AgentDistributionDrawer";
import admin from "../companies/admin.module.css";
import styles from "./hub.module.css";

// The client half of /admin/agents. The page reads server-side and
// passes the composed shape down; everything here is the editing.

export function AgentHubEditor({
  categories,
  agents,
}: {
  categories: HubCategory[];
  agents: HubAgent[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  // Which agent has a drawer open, and which drawer. One pair of
  // drawers for the whole page rather than a pair per row: the panel
  // is a portal to document.body either way, so five rows would have
  // meant five of them stacked in the DOM saying the same thing.
  const [drawer, setDrawer] = useState<{
    agentId: string;
    kind: "edit" | "access" | "config" | "distribution";
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  // One path for every write on this page: clear the last message,
  // run the action, show a refusal or refresh. A refusal from an
  // action is a sentence for a human, so it is shown as written
  // rather than being re-worded here.
  function run(fn: () => Promise<HubResult>) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    run(async () => {
      const result = await createHubCategoryAction(name);
      if (result.ok) setNewCategory("");
      return result;
    });
  }

  function saveRename(id: string) {
    const name = renameText.trim();
    if (!name) return;
    run(async () => {
      const result = await renameHubCategoryAction(id, name);
      if (result.ok) setRenaming(null);
      return result;
    });
  }

  const visibleCategories = [...categories].sort(
    (a, b) => a.sortOrder - b.sortOrder
  );

  // Looked up from the live list rather than held in state, so a
  // refresh while a drawer is open shows the saved row rather than
  // the one that was there when it opened.
  const openAgent = drawer
    ? (agents.find((a) => a.id === drawer.agentId) ?? null)
    : null;

  // An agent whose category row has gone missing would otherwise
  // render nowhere. The foreign key makes that impossible today, but
  // a list that can silently drop a row is a list that hides the one
  // thing this page exists to fix.
  const knownCategoryIds = new Set(categories.map((c) => c.id));
  const orphans = agents.filter((a) => !knownCategoryIds.has(a.categoryId));

  return (
    <>
      {message ? (
        <p
          className={message.ok ? admin.successMessage : admin.errorMessage}
          role="status"
          data-testid="agent-hub-message"
        >
          {message.text}
        </p>
      ) : null}

      <section className={admin.card} data-testid="agent-hub-agents">
        <h2 className={`${admin.h2} ${styles.cardTitle}`}>Agents</h2>
        {/* Its own row under the heading and its description, pushed
            right. Beside the heading it competed with it; here it
            reads as the action you take after reading what the card
            is for. */}
        <div className={styles.cardAction}>
          <button
            type="button"
            className={admin.primaryButton}
            onClick={() => setCreating(true)}
            disabled={pending}
            data-testid="agent-hub-new"
          >
            New agent
          </button>
        </div>

        {visibleCategories.map((category) => {
          const rows = agents
            .filter((a) => a.categoryId === category.id)
            .sort((a, b) => a.sortOrder - b.sortOrder);
          return (
            <div key={category.id} className={styles.categoryBlock}>
              <div className={styles.categoryHead}>
                <h3 className={styles.categoryName}>
                  {category.name}
                  {category.archived ? " (hidden)" : ""}
                </h3>
              </div>
              {rows.length === 0 ? (
                <p className={admin.emptyLine}>No agents in this category.</p>
              ) : (
                rows.map((agent, i) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    isFirst={i === 0}
                    isLast={i === rows.length - 1}
                    pending={pending}
                    run={run}
                    onEdit={() =>
                      setDrawer({ agentId: agent.id, kind: "edit" })
                    }
                    onAccess={() =>
                      setDrawer({ agentId: agent.id, kind: "access" })
                    }
                    onConfig={() =>
                      setDrawer({ agentId: agent.id, kind: "config" })
                    }
                    onDistribute={() =>
                      setDrawer({ agentId: agent.id, kind: "distribution" })
                    }
                  />
                ))
              )}
            </div>
          );
        })}

        {orphans.length > 0 ? (
          <div className={styles.categoryBlock}>
            <div className={styles.categoryHead}>
              <h3 className={styles.categoryName}>Without a category</h3>
            </div>
            {orphans.map((agent, i) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                isFirst={i === 0}
                isLast={i === orphans.length - 1}
                pending={pending}
                run={run}
                onEdit={() => setDrawer({ agentId: agent.id, kind: "edit" })}
                onAccess={() =>
                  setDrawer({ agentId: agent.id, kind: "access" })
                }
                onConfig={() => setDrawer({ agentId: agent.id, kind: "config" })}
                onDistribute={() =>
                  setDrawer({ agentId: agent.id, kind: "distribution" })
                }
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className={admin.card} data-testid="agent-hub-categories">
        <h2 className={`${admin.h2} ${styles.cardTitle}`}>Categories</h2>
        <p className={admin.fieldHint}>
          The headings agents are grouped under in Ask Aimee, in the order they
          appear.
        </p>

        <ul className={admin.list}>
          {visibleCategories.map((category, i) => (
            <li
              key={category.id}
              className={styles.categoryRow}
              data-testid="agent-hub-category-row"
            >
              {renaming === category.id ? (
                <div className={styles.addRow}>
                  <input
                    className={admin.input}
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    maxLength={60}
                    aria-label="Category name"
                  />
                  <button
                    type="button"
                    className={admin.primaryButton}
                    onClick={() => saveRename(category.id)}
                    disabled={pending}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className={admin.ghostButton}
                    onClick={() => setRenaming(null)}
                    disabled={pending}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className={styles.categoryHead}>
                  <span className={styles.categoryRowName}>
                    {category.name}
                    {category.archived ? " (hidden)" : ""}
                  </span>
                  <span className={admin.fieldHint}>
                    {category.agentCount === 1
                      ? "1 agent"
                      : `${category.agentCount} agents`}
                  </span>
                  <div className={styles.headActions}>
                    <button
                      type="button"
                      className={styles.moveButton}
                      onClick={() =>
                        run(() => moveHubCategoryAction(category.id, "up"))
                      }
                      disabled={pending || i === 0}
                      aria-label={`Move ${category.name} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={styles.moveButton}
                      onClick={() =>
                        run(() => moveHubCategoryAction(category.id, "down"))
                      }
                      disabled={pending || i === visibleCategories.length - 1}
                      aria-label={`Move ${category.name} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={admin.ghostButton}
                      onClick={() => {
                        setRenameText(category.name);
                        setRenaming(category.id);
                      }}
                      disabled={pending}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className={admin.dangerGhost}
                      onClick={() =>
                        run(() =>
                          setHubCategoryArchivedAction(
                            category.id,
                            !category.archived
                          )
                        )
                      }
                      disabled={pending}
                    >
                      {category.archived ? "Show again" : "Hide"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className={styles.addRow}>
          <div className={admin.field}>
            <label className={admin.label} htmlFor="new-category">
              Add a category
            </label>
            <input
              id="new-category"
              className={admin.input}
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              maxLength={60}
              placeholder="Planning"
            />
          </div>
          <button
            type="button"
            className={admin.primaryButton}
            onClick={addCategory}
            disabled={pending || !newCategory.trim()}
          >
            Add
          </button>
        </div>
        <p className={admin.fieldHint}>
          A category has to be empty before it can be hidden. Move its agents
          somewhere else first.
        </p>
      </section>

      {openAgent && drawer?.kind === "edit" ? (
        <AgentEditDrawer
          // Keyed by agent, so opening Edit on a different row
          // remounts the form instead of showing the last one's
          // draft with a new heading over it.
          key={openAgent.id}
          agent={openAgent}
          categories={visibleCategories}
          pending={pending}
          run={run}
          onClose={() => setDrawer(null)}
        />
      ) : null}

      {creating ? (
        <AgentCreateDrawer
          categories={visibleCategories}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {openAgent && drawer?.kind === "distribution" ? (
        <AgentDistributionDrawer
          key={openAgent.id}
          agentRowId={openAgent.id}
          title={openAgent.title}
          onClose={() => setDrawer(null)}
        />
      ) : null}

      {openAgent && drawer?.kind === "config" ? (
        <AgentConfigDrawer
          key={openAgent.id}
          agentRowId={openAgent.id}
          slug={openAgent.slug}
          title={openAgent.title}
          hasRegistryEntry={openAgent.hasRegistryEntry}
          access={{
            allowedRoles: openAgent.allowedRoles,
            accessPredicates: openAgent.accessPredicates,
            feature: openAgent.feature,
          }}
          pending={pending}
          onClose={() => setDrawer(null)}
        />
      ) : null}

      {openAgent && drawer?.kind === "access" ? (
        <AgentAccessDrawer
          key={openAgent.id}
          agent={openAgent}
          pending={pending}
          run={run}
          onClose={() => setDrawer(null)}
        />
      ) : null}
    </>
  );
}
