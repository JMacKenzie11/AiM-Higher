"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import type { HubAgent, HubCategory } from "@/lib/practices/hub-service";
import {
  moveAgentToCategoryAction,
  updateAgentIdentityAction,
  updateAgentOfferWhenAction,
  type HubResult,
} from "@/lib/practices/hub-actions";
import admin from "../companies/admin.module.css";
import styles from "./hub.module.css";
import { OFFER_WHEN_MAX } from "@/lib/practices/offer-when-limits";

// Name, description, when Aimee offers it, and category, in the
// house drawer.
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
  const [offerWhen, setOfferWhen] = useState(agent.offerWhen ?? "");
  const [categoryId, setCategoryId] = useState(agent.categoryId);

  // The description box grows to fit what is in it.
  //
  // A fixed rows={4} cut the longest seeded description in half, and
  // the field a system admin most often opens this drawer to read is
  // the one that was clipped. Height is driven off scrollHeight
  // rather than a row count because the text wraps, so the number of
  // visual lines is not the number of newlines.
  const descRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    // Reset first: without it the box can only ever grow, because
    // scrollHeight of an already-tall element never shrinks.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);

  function save() {
    run(async () => {
      const identity = await updateAgentIdentityAction(agent.id, {
        title,
        description,
      });
      if (!identity.ok) return identity;
      // Only when it changed, so an instance the 0262 column has not
      // reached can still rename an agent (hub-actions.ts).
      if (offerWhen.trim() !== (agent.offerWhen ?? "")) {
        const offer = await updateAgentOfferWhenAction(agent.id, offerWhen);
        if (!offer.ok) return offer;
      }
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
        </div>

        <div className={admin.field}>
          <label className={admin.label} htmlFor="agent-description">
            Description
          </label>
          <textarea
            id="agent-description"
            ref={descRef}
            className={`${admin.input} ${styles.growTextarea}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={300}
          />
        </div>

        <div className={admin.field}>
          <label className={admin.label} htmlFor="agent-offer-when">
            Offer this when
          </label>
          <textarea
            id="agent-offer-when"
            className={`${admin.input} ${styles.growTextarea}`}
            value={offerWhen}
            onChange={(e) => setOfferWhen(e.target.value)}
            rows={2}
            maxLength={OFFER_WHEN_MAX}
            placeholder="Someone needs to raise a problem with a person and isn't sure how to start."
            aria-describedby="agent-offer-when-hint"
          />
          <span id="agent-offer-when-hint" className={admin.fieldHint}>
            What a person says or is dealing with when this agent would help. Aimee reads it to decide when to offer the agent in a conversation. Leave it empty and Aimee never offers it.
          </span>
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
        </div>
      </div>
    </Drawer>
  );
}
