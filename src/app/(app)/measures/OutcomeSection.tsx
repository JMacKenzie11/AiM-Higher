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
  authoring,
  canLog,
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
  authoring: boolean;
  canLog: boolean;
  trackingEnabled: boolean;
  rdEnabled: boolean;
  weekEnding: string;
}) {
  const [editingDetails, setEditingDetails] = useState(false);
  const [addMeasureOpen, setAddMeasureOpen] = useState(false);
  const visibleMeasures = outcome.measures.filter(isVisible);
  // The critical success factor is filtered on the same footing as
  // its KPIs. It is counted by the chips, so a chip that counts it
  // and then leaves it on screen would make the numbers stop
  // matching what you can see.
  const csfVisible = isVisible({ ...outcome, description: outcome.title });

  return (
    <div className={styles.outcomeBlock}>
      {outcome.measures.length === 0 && !trackingEnabled ? (
        <p className={styles.outcomeEmpty}>
          {authoring
            ? "No KPIs yet. Add the leading activity that moves this number."
            : "No KPIs yet."}
        </p>
      ) : visibleMeasures.length === 0 && !trackingEnabled ? (
        <p className={styles.outcomeEmpty}>
          Every KPI here is hidden by the current filter.
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
            <span>KPI</span>
            {trackingEnabled ? (
              <>
                <span>Target</span>
                <span className={styles.headCellHideMobile}>Recent</span>
                <span>This week</span>
                <span className={styles.headCellHideMobile} aria-hidden />
              </>
            ) : null}
            <span aria-hidden />
          </div>
          {csfVisible ? (
          <>
          {/* The critical success factor IS the first row, not a
              heading above one. It used to be both: the card had a
              title and then its own table repeated that title four
              lines down, which read as two objects with one name.
              Collapsing them also removes a level of nesting and the
              split where the name was edited in one place and the
              target in another. */}
          <ManagedMeasureRow
            // A CSF keeps its name in `title` for the chart's sake;
            // a measure row reads `description`. Mapped here so the
            // row stays one shape.
            measure={{ ...outcome, description: outcome.title }}
            outcomeTitle={outcome.title}
            outcomeDescription={outcome.description}
            value={values[outcome.id] ?? ""}
            onValueChange={(v) => onValueChange(outcome.id, v)}
            disabled={disabled}
            authoring={authoring}
            trackingEnabled={trackingEnabled}
            weekEnding={weekEnding}
            canLog={canLog}
            kind="csf"
            archiveSlot={
              authoring ? <ArchiveOutcomeButton outcomeId={outcome.id} /> : null
            }
          />
          </>
          ) : null}

          {visibleMeasures.map((m) => (
            <ManagedMeasureRow
              key={m.id}
              measure={m}
              outcomeTitle={outcome.title}
              outcomeDescription={outcome.description}
              value={values[m.id] ?? ""}
              onValueChange={(v) => onValueChange(m.id, v)}
              disabled={disabled}
              authoring={authoring}
              canLog={canLog}
              trackingEnabled={trackingEnabled}
              weekEnding={weekEnding}
            />
          ))}
        </div>
      )}

      {/* A nudge, not a limit. Three lead measures is about what a
          function head can actually move in a week; past that the
          list becomes a report nobody acts on. Deliberately advisory:
          some functions genuinely need a fourth, and a hard cap would
          just push people into vaguer KPIs that bundle two things. */}
      {authoring && outcome.measures.length >= 3 ? (
        <p className={styles.outcomeNudge}>
          {outcome.measures.length} KPIs on this critical success
          factor. Two or three is usually enough. More than that and
          the weekly update becomes a chore rather than a decision.
        </p>
      ) : null}

      {authoring ? (
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
              + Add a KPI
            </button>
          )}
        </div>
      ) : null}
    </div>
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
        message="Its KPIs are archived with it. Historical weekly entries are kept."
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
