"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  archiveOutcomeAction,
  renameOutcomeAction,
  updateOutcomeAction,
  type ChartResult,
} from "@/lib/chart/actions";
import type {
  FunctionOutcome,
  SuccessMeasure,
  SuccessMeasureEntry,
} from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import uiStyles from "@/components/ui/ui.module.css";
import { AddMetricRow } from "./AddMetricRow";
import { MetricRow } from "./MetricRow";
import styles from "../../chart.module.css";

const INITIAL: ChartResult<FunctionOutcome> = { ok: false, message: "" };

export type SuccessMeasureCardOutcome = FunctionOutcome & {
  measures: Array<SuccessMeasure & { entries: SuccessMeasureEntry[] }>;
};

export function SuccessMeasureCard({
  outcome,
  functionId,
  canEdit,
  rdEnabled,
}: {
  outcome: SuccessMeasureCardOutcome;
  functionId: string;
  canEdit: boolean;
  rdEnabled: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <article className={styles.detailOutcome}>
      {editing ? (
        <EditOutcomeForm outcome={outcome} onDone={() => setEditing(false)} />
      ) : (
        <div className={styles.detailOutcomeHeader}>
          <div>
            <p className={styles.outcomeLabel}>Success Measure</p>
            {canEdit ? (
              <InlineTitleEditor outcome={outcome} />
            ) : (
              <h3 className={styles.detailOutcomeTitle}>{outcome.title}</h3>
            )}
            {outcome.description ? (
              <p className={styles.subtitle}>{outcome.description}</p>
            ) : null}
          </div>
          {canEdit ? (
            <div className={styles.detailOutcomeActions}>
              <button
                type="button"
                className={styles.roleGhostButton}
                onClick={() => setEditing(true)}
                title="Edit description and other details"
              >
                Details
              </button>
              <ArchiveOutcomeButton outcomeId={outcome.id} />
            </div>
          ) : null}
        </div>
      )}

      {outcome.measures.length > 0 ? (
        <ul className={styles.detailMeasureList}>
          {outcome.measures.map((m) => (
            <MetricRow
              key={m.id}
              measure={m}
              canEdit={canEdit}
              outcomeTitle={outcome.title}
              outcomeDescription={outcome.description}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.emptyOutcomeLine}>No metrics yet.</p>
      )}

      {canEdit ? (
        <AddMetricRow
          outcomeId={outcome.id}
          outcomeTitle={outcome.title}
          outcomeDescription={outcome.description}
          functionId={functionId}
          rdEnabled={rdEnabled}
        />
      ) : null}
    </article>
  );
}

function InlineTitleEditor({
  outcome,
}: {
  outcome: SuccessMeasureCardOutcome;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(outcome.title);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(outcome.title);
  }, [outcome.title]);

  function commit() {
    if (pending) return;
    const next = draft.trim();
    if (!next) {
      cancel();
      return;
    }
    if (next === outcome.title) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameOutcomeAction(outcome.id, next);
      if (!result.ok) {
        setError(result.message);
      } else {
        setEditing(false);
      }
    });
  }

  function cancel() {
    setDraft(outcome.title);
    setEditing(false);
    setError(null);
  }

  if (editing) {
    return (
      <>
        <input
          className={styles.outcomeTitleInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          autoFocus
          disabled={pending}
          aria-label="Edit success measure title"
        />
        {error ? (
          <p role="alert" className={styles.roleError}>
            {error}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <button
      type="button"
      className={styles.outcomeTitleEditable}
      onClick={() => setEditing(true)}
      title="Click to rename"
    >
      {outcome.title}
    </button>
  );
}

function EditOutcomeForm({
  outcome,
  onDone,
}: {
  outcome: FunctionOutcome;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ChartResult<FunctionOutcome>,
    FormData
  >(updateOutcomeAction, INITIAL);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  useEffect(() => {
    if (state && "ok" in state && state.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className={styles.addForm}>
      <input type="hidden" name="id" value={outcome.id} />

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>Success measure</span>
        <input
          className={styles.formInput}
          type="text"
          name="title"
          defaultValue={outcome.title}
          required
          disabled={pending}
          autoFocus
        />
      </label>

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>Why this matters (optional)</span>
        <textarea
          className={styles.formTextarea}
          name="description"
          defaultValue={outcome.description ?? ""}
          rows={2}
          disabled={pending}
        />
      </label>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.formSubmit}>
        <button type="submit" className={uiStyles.btnPrimary} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className={uiStyles.btnGhost}
          disabled={pending}
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ArchiveOutcomeButton({ outcomeId }: { outcomeId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function run() {
    setConfirming(false);
    startTransition(async () => {
      const result = await archiveOutcomeAction(outcomeId, true);
      if (!result.ok) setMessage(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        className={styles.roleDeleteIcon}
        onClick={() => setConfirming(true)}
        disabled={pending}
        aria-label="Archive this success measure"
        title="Archive this success measure"
      >
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
          <path
            d="M4 5 h8 v8 a1 1 0 0 1 -1 1 h-6 a1 1 0 0 1 -1 -1 z M6.5 5 V3.5 a1 1 0 0 1 1 -1 h1 a1 1 0 0 1 1 1 V5 M3 5 h10"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <ConfirmDialog
        open={confirming}
        title="Archive this success measure?"
        message="Its metrics stay linked to it but disappear from the function. Historical weekly entries are kept."
        confirmLabel="Archive"
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
      {message ? (
        <p role="alert" className={styles.roleError}>
          {message}
        </p>
      ) : null}
    </>
  );
}
