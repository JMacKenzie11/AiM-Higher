"use client";

import Link from "next/link";
import { PlusIcon } from "../../../components/ui/PlusIcon";
import { useState, useTransition } from "react";
import { archiveOutcomeAction } from "@/lib/chart/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type {
  MeasureTreeFunction,
  MeasureRow,
} from "@/lib/measures/service";
import styles from "./measures.module.css";
import uiStyles from "@/components/ui/ui.module.css";
import { ManagedMeasureRow } from "./ManagedMeasureRow";
import { AddOutcomeInline } from "./AddOutcomeInline";

// One function, one list of critical success factors.
//
// ---- WHAT 0216 TOOK OUT ---------------------------------------
//
// This used to render a card per critical success factor, each with
// its own grid, its own "Add a KPI" button, and a nudge when a CSF
// collected more than three of them. That structure was the data
// model's, not the client's: the spreadsheet every company actually
// keeps has one row per measure and one target column.
//
// So OutcomeSection is gone and its grid moved here. A function now
// draws one table, one row per measure, which is the shape the
// six-month grid builds on next.

export function FunctionSection({
  fn,
  isVisible,
  values,
  onValueChange,
  disabled,
  isAdmin,
  authoring,
  trackingEnabled,
  weekEnding,
  onSave,
  saving,
}: {
  fn: MeasureTreeFunction;
  isVisible: (m: MeasureRow) => boolean;
  values: Record<string, string>;
  onValueChange: (id: string, v: string) => void;
  disabled: boolean;
  isAdmin: boolean;
  // Seeing every function is an admin question; showing the add and
  // delete controls is a mode question. They were the same flag.
  authoring: boolean;
  trackingEnabled: boolean;
  weekEnding: string;
  onSave: () => void;
  saving: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);

  // A CSF's name lives in `title`; the row and the filter read
  // `description`. Mapped once, here, so everything below this line
  // sees one shape.
  const rows: MeasureRow[] = fn.csfs.map((c) => ({ ...c, description: c.title }));

  // An admin keeps the whole function on screen even when the filter
  // matches nothing, or the "add" control disappears and a chip
  // silently blocks authoring.
  const visibleRows = isAdmin ? rows : rows.filter(isVisible);

  if (visibleRows.length === 0 && !isAdmin) return null;

  return (
    <section
      id={`fn-${fn.id}`}
      className={styles.fnSection}
      aria-labelledby={`fn-title-${fn.id}`}
    >
      <header className={styles.fnHeader}>
        <h2 id={`fn-title-${fn.id}`} className={styles.fnTitle}>
          <Link href={`/chart/function/${fn.id}`} className={styles.fnTitleLink}>
            {fn.title}
          </Link>
        </h2>
      </header>

      {visibleRows.length === 0 ? (
        <p className={styles.fnEmpty}>
          No critical success factors yet. Add the first below.
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
          <div className={styles.measureGridHead} role="row" aria-hidden="true">
            {/* The first column is deliberately unlabelled. Every row
                in it is a critical success factor and the section
                heading above already says so, which is exactly what
                changed in 0216: the column used to hold two kinds and
                could not be named without implying one was a sort of
                the other. */}
            <span />
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

          {visibleRows.map((row) => (
            <ManagedMeasureRow
              key={row.id}
              measure={row}
              outcomeTitle={row.title}
              outcomeDescription={row.description}
              value={values[row.id] ?? ""}
              onValueChange={(v) => onValueChange(row.id, v)}
              disabled={disabled}
              authoring={authoring}
              trackingEnabled={trackingEnabled}
              weekEnding={weekEnding}
              canLog={fn.canLog}
              archiveSlot={
                authoring ? <ArchiveCsfButton csfId={row.id} /> : null
              }
            />
          ))}
        </div>
      )}

      {trackingEnabled && fn.canLog && visibleRows.length > 0 ? (
        <div className={styles.fnSaveRow}>
          <button
            type="button"
            className={uiStyles.btnPrimary}
            onClick={onSave}
            disabled={disabled}
          >
            {/* The function's name is already the card's heading
                directly above, so repeating it here only made the
                button wide enough to read as something else. */}
            {saving ? "Saving…" : "Save this week"}
          </button>
        </div>
      ) : null}

      {authoring ? (
        addOpen ? (
          <div className={styles.addPanel}>
            <AddOutcomeInline
              functionId={fn.id}
              onAdded={() => setAddOpen(false)}
            />
            <button
              type="button"
              className={styles.addPanelClose}
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.addToggleButton}
            onClick={() => setAddOpen(true)}
          >
            <PlusIcon />Add a critical success factor
          </button>
        )
      ) : null}
    </section>
  );
}

// Archiving takes the measure off the page and keeps it on file. It
// used to warn that the KPIs beneath went with it, which is no longer
// true of anything: there is nothing beneath a measure.
function ArchiveCsfButton({ csfId }: { csfId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function run() {
    setConfirming(false);
    startTransition(async () => {
      const result = await archiveOutcomeAction(csfId, true);
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
        title="Archive this critical success factor"
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
        title="Archive this critical success factor?"
        message="It comes off the page and stays on file. Weekly entries already logged are kept."
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
