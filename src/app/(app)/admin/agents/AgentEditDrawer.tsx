"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import type { HubAgent, HubCategory } from "@/lib/practices/hub-service";
import {
  moveAgentToCategoryAction,
  updateAgentIdentityAction,
  type HubResult,
} from "@/lib/practices/hub-actions";
import admin from "../companies/admin.module.css";
import styles from "./hub.module.css";

// Name, description and category, in the house drawer.
//
// The drawer UNMOUNTS on close, which is what seeds these three from
// props on every open. The previous inline panel had to re-seed by
// hand and got it wrong once, showing yesterday's half-typed name.
// Nothing in here owns in-flight work — `run` belongs to the editor
// and survives this closing — so keepMounted would buy nothing.

export function AgentEditDrawer({
  agent,
  categories,
  pending,
  run,
  onClose,
}: {
  agent: HubAgent;
  categories: HubCategory[];
  pending: boolean;
  run: (fn: () => Promise<HubResult>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(agent.title);
  const [description, setDescription] = useState(agent.description);
  const [categoryId, setCategoryId] = useState(agent.categoryId);

  function save() {
    run(async () => {
      const identity = await updateAgentIdentityAction(agent.id, {
        title,
        description,
      });
      if (!identity.ok) return identity;
      // Category is a different action with different semantics, so
      // it only runs when it actually changed. One click, though:
      // splitting Save in two would make the drawer disagree with
      // every other form in the app.
      if (categoryId !== agent.categoryId) {
        const moved = await moveAgentToCategoryAction(agent.id, categoryId);
        if (!moved.ok) return moved;
      }
      onClose();
      return { ok: true };
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      name="agent-edit"
      eyebrow="Edit agent"
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
          <label className={admin.label} htmlFor="agent-title">
            Name
          </label>
          <input
            id="agent-title"
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
          <label className={admin.label} htmlFor="agent-description">
            Description
          </label>
          <textarea
            id="agent-description"
            className={admin.input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={300}
          />
          <p className={admin.fieldHint}>
            One line under the name, saying what the agent helps with.
          </p>
        </div>

        <div className={admin.field}>
          <label className={admin.label} htmlFor="agent-category">
            Category
          </label>
          <select
            id="agent-category"
            className={admin.select}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
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
            Moving an agent puts it last in the new category. Use the arrows
            on its row to move it up.
          </p>
        </div>
      </div>
    </Drawer>
  );
}
