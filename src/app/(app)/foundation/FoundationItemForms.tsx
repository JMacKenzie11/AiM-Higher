"use client";

import { useActionState, useState } from "react";
import {
  createFoundationItemAction,
  updateFoundationItemAction,
  type Result,
} from "@/lib/foundation/actions";
import type { FoundationItem, FoundationItemKind } from "@/lib/types";
import styles from "./foundation.module.css";

const INITIAL: Result<FoundationItem> = { ok: false, message: "" };

// Reusable Add form for Core Values / Vision Milestones / Differentiators.
// Kind is passed as a hidden input so the same action handles all three.

export function AddFoundationItemForm({
  kind,
  addLabel,
  titleLabel = "Title",
  bodyLabel = "Body",
}: {
  kind: FoundationItemKind;
  addLabel: string;
  titleLabel?: string;
  bodyLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<
    Result<FoundationItem>,
    FormData
  >(createFoundationItemAction, INITIAL);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  return (
    <details className={styles.editDetails}>
      <summary className={styles.editSummary}>+ {addLabel}</summary>
      <form action={formAction} className={styles.form}>
        <input type="hidden" name="kind" value={kind} />

        <div className={styles.fieldWide}>
          <label className={styles.label}>{titleLabel}</label>
          <input
            name="title"
            required
            className={styles.input}
            disabled={pending}
          />
        </div>
        <div className={styles.fieldWide}>
          <label className={styles.label}>{bodyLabel}</label>
          <textarea
            name="body"
            className={styles.textarea}
            rows={3}
            disabled={pending}
          />
        </div>

        {errorMessage ? (
          <p role="alert" className={styles.errorMessage}>
            {errorMessage}
          </p>
        ) : null}

        <div className={styles.submitRow}>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={pending}
          >
            {pending ? "Adding…" : addLabel}
          </button>
        </div>
      </form>
    </details>
  );
}

export function EditFoundationItemForm({
  item,
  titleLabel = "Title",
  bodyLabel = "Body",
}: {
  item: FoundationItem;
  titleLabel?: string;
  bodyLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<
    Result<FoundationItem>,
    FormData
  >(updateFoundationItemAction, INITIAL);
  const [open, setOpen] = useState(false);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  if (!open) {
    return (
      <button
        type="button"
        className={styles.ghostButton}
        onClick={() => setOpen(true)}
      >
        Edit
      </button>
    );
  }

  return (
    <form
      action={(data) => {
        formAction(data);
        setOpen(false);
      }}
      className={styles.form}
    >
      <input type="hidden" name="id" value={item.id} />
      <div className={styles.fieldWide}>
        <label className={styles.label}>{titleLabel}</label>
        <input
          name="title"
          required
          defaultValue={item.title}
          className={styles.input}
          disabled={pending}
        />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label}>{bodyLabel}</label>
        <textarea
          name="body"
          defaultValue={item.body ?? ""}
          className={styles.textarea}
          rows={3}
          disabled={pending}
        />
      </div>
      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}
      <div className={styles.submitRow}>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
