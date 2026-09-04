"use client";

import {
  useActionState,
  useEffect,
  useState,
  useTransition,
} from "react";
import {
  archiveOutcomeAction,
  renameOutcomeAction,
  updateOutcomeAction,
  type ChartResult,
} from "@/lib/chart/actions";
import type {
  MeasureTreeMeasure,
  MeasureTreeOutcome,
} from "@/lib/measures/service";
import type { FunctionOutcome } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import uiStyles from "@/components/ui/ui.module.css";
import { AddMetricRow } from "../chart/function/[id]/AddMetricRow";
import { ManagedMeasureRow } from "./ManagedMeasureRow";
import styles from "./measures.module.css";
import chartStyles from "../chart/chart.module.css";

const INITIAL: ChartResult<FunctionOutcome> = { ok: false, message: "" };

export function OutcomeSection({
  outcome,
  functionId,
  isVisible,
  values,
  onValueChange,
  disabled,
  isAdmin,
  trackingEnabled,
  rdEnabled,
  weekEnding,
}: {
  outcome: MeasureTreeOutcome;
  functionId: string;
  isVisible: (m: MeasureTreeMeasure) => boolean;
  values: Record<string, string>;
  onValueChange: (id: string, v: string) => void;
  disabled: boolean;
  isAdmin: boolean;
  trackingEnabled: boolean;
  rdEnabled: boolean;
  weekEnding: string;
}) {
  const [editingDetails, setEditingDetails] = useState(false);
  const [addMeasureOpen, setAddMeasureOpen] = useState(false);
  const visibleMeasures = outcome.measures.filter(isVisible);

  return (
    <div className={styles.outcomeBlock}>
      {editingDetails ? (
        <EditOutcomeForm
          outcome={outcome}
          onDone={() => setEditingDetails(false)}
        />
      ) : (
        <header className={styles.outcomeHeader}>
          <div className={styles.outcomeHeaderTitleWrap}>
            <p className={styles.outcomeLabel}>Critical Success Factor</p>
            {isAdmin ? (
              <InlineOutcomeTitleEditor outcome={outcome} />
            ) : (
              <h3 className={styles.outcomeTitle}>{outcome.title}</h3>
            )}
            {outcome.description ? (
              <p className={styles.outcomeDescription}>
                {outcome.description}
              </p>
            ) : null}
          </div>
          {isAdmin ? (
            <div className={styles.outcomeHeaderActions}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setEditingDetails(true)}
                title="Edit description"
              >
                Details
              </button>
              <ArchiveOutcomeButton outcomeId={outcome.id} />
            </div>
          ) : null}
        </header>
      )}

      {outcome.measures.length === 0 ? (
        <p className={styles.outcomeEmpty}>
          {isAdmin
            ? "No key success measures yet. Add one below."
            : "No key success measures yet."}
        </p>
      ) : visibleMeasures.length === 0 ? (
        <p className={styles.outcomeEmpty}>
          All measures on this outcome are hidden by the current filter.
        </p>
      ) : (
        <div
          className={
            trackingEnabled
              ? styles.measureGrid
              : `${styles.measureGrid} ${styles.measureGridAuthor}`
          }
          role="table"
        >
          <div
            className={styles.measureGridHead}
            role="row"
            aria-hidden="true"
          >
            <span>Measure</span>
            {trackingEnabled ? (
              <>
                <span>Target</span>
                <span className={styles.headCellHideMobile}>Recent</span>
                <span>This week</span>
                <span className={styles.headCellHideMobile} aria-hidden />
              </>
            ) : null}
            {isAdmin ? <span aria-hidden /> : null}
          </div>
          {visibleMeasures.map((m) => (
            <ManagedMeasureRow
              key={m.id}
              measure={m}
              outcomeTitle={outcome.title}
              outcomeDescription={outcome.description}
              value={values[m.id] ?? ""}
              onValueChange={(v) => onValueChange(m.id, v)}
              disabled={disabled}
              isAdmin={isAdmin}
              trackingEnabled={trackingEnabled}
              weekEnding={weekEnding}
            />
          ))}
        </div>
      )}

      {isAdmin ? (
        <div className={styles.outcomeAdd}>
          {addMeasureOpen ? (
            <div className={styles.addPanel}>
              <AddMetricRow
                outcomeId={outcome.id}
                outcomeTitle={outcome.title}
                outcomeDescription={outcome.description}
                functionId={functionId}
                rdEnabled={rdEnabled}
                trackingEnabled={trackingEnabled}
                onAdded={() => setAddMeasureOpen(false)}
              />
              <button
                type="button"
                className={styles.addPanelClose}
                onClick={() => setAddMeasureOpen(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.addToggleButton}
              onClick={() => setAddMeasureOpen(true)}
            >
              + Add a key success measure
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function InlineOutcomeTitleEditor({
  outcome,
}: {
  outcome: MeasureTreeOutcome;
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
      if (!result.ok) setError(result.message);
      else setEditing(false);
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
          aria-label="Edit critical success factor"
        />
        {error ? (
          <p role="alert" className={styles.rowError}>
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
  outcome: MeasureTreeOutcome;
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
    <form action={formAction} className={chartStyles.addForm}>
      <input type="hidden" name="id" value={outcome.id} />

      <label
        className={`${chartStyles.formField} ${chartStyles.formFieldFull}`}
      >
        <span className={chartStyles.formLabel}>Critical Success Factor</span>
        <input
          className={chartStyles.formInput}
          type="text"
          name="title"
          defaultValue={outcome.title}
          required
          disabled={pending}
          autoFocus
        />
      </label>

      <label
        className={`${chartStyles.formField} ${chartStyles.formFieldFull}`}
      >
        <span className={chartStyles.formLabel}>
          Why this matters (optional)
        </span>
        <textarea
          className={chartStyles.formTextarea}
          name="description"
          defaultValue={outcome.description ?? ""}
          rows={2}
          disabled={pending}
        />
      </label>

      {errorMessage ? (
        <p role="alert" className={chartStyles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={chartStyles.formSubmit}>
        <button
          type="submit"
          className={uiStyles.btnPrimary}
          disabled={pending}
        >
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
        className={styles.iconDeleteButton}
        onClick={() => setConfirming(true)}
        disabled={pending}
        aria-label="Archive this critical success factor"
        title="Archive this outcome"
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
        title="Archive this outcome?"
        message="Its key success measures stay linked to it but disappear from the function. Historical weekly entries are kept."
        confirmLabel="Archive"
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
      {message ? (
        <p role="alert" className={styles.rowError}>
          {message}
        </p>
      ) : null}
    </>
  );
}
