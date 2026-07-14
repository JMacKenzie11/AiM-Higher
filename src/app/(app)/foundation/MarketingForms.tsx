"use client";

import { useActionState, useState } from "react";
import {
  createPillarAction,
  createSnippetAction,
  updatePillarAction,
  upsertMarketingAction,
  type Result,
} from "@/lib/foundation/actions";
import type {
  MarketingSnippet,
  MarketingSnippetKind,
  MarketingStrategy,
  MessagingPillar,
} from "@/lib/types";
import styles from "./foundation.module.css";

const INITIAL_MS: Result<MarketingStrategy> = { ok: false, message: "" };
const INITIAL_PILLAR: Result<MessagingPillar> = { ok: false, message: "" };
const INITIAL_SNIPPET: Result<MarketingSnippet> = { ok: false, message: "" };

export function MarketingStrategyForm({
  marketing,
}: {
  marketing: MarketingStrategy | null;
}) {
  const [state, formAction, pending] = useActionState<
    Result<MarketingStrategy>,
    FormData
  >(upsertMarketingAction, INITIAL_MS);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.fieldWide}>
        <label className={styles.label}>Positioning statement</label>
        <textarea
          name="positioning_statement"
          className={styles.textarea}
          defaultValue={marketing?.positioning_statement ?? ""}
          rows={3}
          disabled={pending}
        />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label}>Executive summary</label>
        <textarea
          name="executive_summary"
          className={styles.textarea}
          defaultValue={marketing?.executive_summary ?? ""}
          rows={4}
          disabled={pending}
        />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label}>Anchoring message</label>
        <textarea
          name="anchoring_message"
          className={styles.textarea}
          defaultValue={marketing?.anchoring_message ?? ""}
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
          {pending ? "Saving…" : "Save marketing strategy"}
        </button>
      </div>
    </form>
  );
}

// ---------------- Pillar add/edit -------------------------------

export function AddPillarForm() {
  const [state, formAction, pending] = useActionState<
    Result<MessagingPillar>,
    FormData
  >(createPillarAction, INITIAL_PILLAR);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  return (
    <details className={styles.editDetails}>
      <summary className={styles.editSummary}>+ Add messaging pillar</summary>
      <form action={formAction} className={styles.form}>
        <div className={styles.fieldWide}>
          <label className={styles.label}>Pillar name</label>
          <input
            name="name"
            required
            className={styles.input}
            disabled={pending}
          />
        </div>
        <div className={styles.fieldWide}>
          <label className={styles.label}>Core message</label>
          <textarea
            name="message"
            className={styles.textarea}
            rows={3}
            disabled={pending}
          />
        </div>
        <div className={styles.fieldWide}>
          <label className={styles.label}>Language bank (one phrase per line)</label>
          <textarea
            name="language_bank"
            className={styles.textarea}
            rows={4}
            placeholder="Phrases to use verbatim."
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
            {pending ? "Adding…" : "Add pillar"}
          </button>
        </div>
      </form>
    </details>
  );
}

export function EditPillarForm({ pillar }: { pillar: MessagingPillar }) {
  const [state, formAction, pending] = useActionState<
    Result<MessagingPillar>,
    FormData
  >(updatePillarAction, INITIAL_PILLAR);
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
      <input type="hidden" name="id" value={pillar.id} />
      <div className={styles.fieldWide}>
        <label className={styles.label}>Pillar name</label>
        <input
          name="name"
          required
          defaultValue={pillar.name}
          className={styles.input}
          disabled={pending}
        />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label}>Core message</label>
        <textarea
          name="message"
          defaultValue={pillar.message ?? ""}
          className={styles.textarea}
          rows={3}
          disabled={pending}
        />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label}>Language bank</label>
        <textarea
          name="language_bank"
          defaultValue={(pillar.language_bank ?? []).join("\n")}
          className={styles.textarea}
          rows={4}
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

// ---------------- Snippet add ----------------------------------

export function AddSnippetForm({
  kind,
  addLabel,
  placeholder,
}: {
  kind: MarketingSnippetKind;
  addLabel: string;
  placeholder?: string;
}) {
  const [state, formAction, pending] = useActionState<
    Result<MarketingSnippet>,
    FormData
  >(createSnippetAction, INITIAL_SNIPPET);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  return (
    <details className={styles.editDetails}>
      <summary className={styles.editSummary}>+ {addLabel}</summary>
      <form action={formAction} className={styles.form}>
        <input type="hidden" name="kind" value={kind} />
        <div className={styles.fieldWide}>
          <label className={styles.label}>{addLabel}</label>
          <textarea
            name="content"
            required
            className={styles.textarea}
            rows={2}
            placeholder={placeholder}
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
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
      </form>
    </details>
  );
}
