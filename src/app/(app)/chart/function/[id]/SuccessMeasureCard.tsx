"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  archiveOutcomeAction,
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
  canEdit,
  canLog,
  weekEnding,
}: {
  outcome: SuccessMeasureCardOutcome;
  canEdit: boolean;
  canLog: boolean;
  weekEnding: string;
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
            <h3 className={styles.detailOutcomeTitle}>{outcome.title}</h3>
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
              >
                Edit
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
              entries={m.entries}
              canEdit={canEdit}
              canLog={canLog}
              weekEnding={weekEnding}
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
        />
      ) : null}
    </article>
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
        className={styles.roleDangerButton}
        onClick={() => setConfirming(true)}
        disabled={pending}
      >
        Archive
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
