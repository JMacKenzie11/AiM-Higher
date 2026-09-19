"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  logMeasureEntriesAction,
  type MeasureEntryInput,
} from "@/lib/measures/actions";
import type { GridData, GridRow } from "@/lib/measures/grid";
import { EditMeasureForm, ArchiveMeasureButton } from "./EditMeasureForm";
import { ExternalMeasureNote } from "./external/ExternalMeasureNote";
import { formatShortDate } from "@/lib/dates";
import uiStyles from "@/components/ui/ui.module.css";
import styles from "./measures.module.css";

// The /measures grid.
//
// Functional Area | Owner | Critical Success Factor | Frequency |
// Target | one column per week, six months of them.
//
// ---- WHY A TABLE AND NOT THE CSS GRID THAT WAS HERE ----------
//
// The page was a CSS grid with `display: contents` rows, which places
// every cell against the parent's tracks. That works when the column
// count is fixed. Here it is not: a month collapses to one column and
// expands to four or five, so the track list changes as you click.
//
// A table does the two things that then matter for free: rows stay
// aligned however many cells a header spans, and the first columns
// pin with `position: sticky` while the weeks scroll under them. The
// old grid needed a test to catch a row emitting the wrong number of
// cells (grid-alignment.test.ts); colspan is checked by the browser.
//
// ---- MONTH STATE IS REACT'S, AND THAT IS SAFE HERE -----------
//
// The plan toolbar keeps its panels as native <details> because React
// state there discarded an in-flight router.refresh() and a created
// row never appeared. Nothing here is a form submission: opening a
// month is local, and the save below goes through useTransition,
// which preserves this component's state across the refresh.
//
// ---- THIS WEEK IS THE ONLY EDITABLE COLUMN -------------------
//
// Deliberate, and a departure from a real spreadsheet. The save
// action takes one week_ending, and a grid where any of 26 cells is
// editable invites somebody to correct a number from April with no
// record that it was corrected. Past weeks are read-only here;
// fixing one is a conversation, not a keystroke.

export function MeasuresGrid({
  data,
  weekEnding,
  authoring,
  trackingEnabled,
}: {
  data: GridData;
  weekEnding: string;
  authoring: boolean;
  trackingEnabled: boolean;
}) {
  // Open on the current month, with the rest closed. Six months of
  // Fridays is 26 columns and nobody needs 26 at once; the week you
  // are filling in should be on screen without scrolling to it.
  const [openMonths, setOpenMonths] = useState<Set<string>>(
    () => new Set(data.months.filter((m) => m.isCurrent).map((m) => m.key))
  );

  const writableRows = useMemo(
    () =>
      data.groups
        .filter((g) => g.canLog)
        .flatMap((g) => g.rows.filter((r) => isDueThisWeek(r, weekEnding))),
    [data.groups, weekEnding]
  );

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      data.groups.flatMap((g) =>
        g.rows.map((r) => [r.id, currentValueOf(r, weekEnding)])
      )
    )
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  // Which row's settings are open. One at a time: the form spans the
  // whole table and two of them would push the grid off the screen.
  const [editing, setEditing] = useState<string | null>(null);

  // Open at the right-hand edge, where this week is.
  //
  // The current month is the last one and the week you are filling in
  // is its last column, so a table that opens scrolled to zero opens
  // on April. Done once on mount rather than on every render: after
  // that the scroll position is the reader's, and yanking it back
  // when they open a month would be worse than opening in the wrong
  // place.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const outstanding = writableRows.filter(
    (r) => !(values[r.id] ?? "").trim()
  ).length;

  function toggleMonth(key: string) {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save() {
    setMessage(null);
    const entries: MeasureEntryInput[] = writableRows.map((r) => ({
      measureId: r.id,
      valueType: r.valueType,
      rawValue: values[r.id] ?? "",
    }));
    startTransition(async () => {
      const result = await logMeasureEntriesAction(entries, weekEnding);
      if (result.ok) {
        setMessage({
          ok: true,
          text:
            result.savedCount === 0
              ? "Nothing to save. Enter values first."
              : `Saved ${result.savedCount} value${result.savedCount === 1 ? "" : "s"}.`,
        });
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  // Every column the body has to emit, in order, so a row and the
  // header cannot disagree about how many cells there are.
  type Column =
    | { kind: "week"; key: string; month: string }
    | { kind: "month"; key: string; month: string };
  const columns = useMemo<Column[]>(
    () =>
      data.months.flatMap((m): Column[] =>
        openMonths.has(m.key)
          ? m.weeks.map((w) => ({ kind: "week", key: w, month: m.key }))
          : [{ kind: "month", key: m.key, month: m.key }]
      ),
    [data.months, openMonths]
  );

  if (!data.hasRows) return null;

  return (
    <div className={styles.gridStack}>
      {trackingEnabled && writableRows.length > 0 ? (
        <div className={styles.gridToolbar}>
          <p
            className={
              outstanding === 0 ? styles.outstandingDone : styles.outstanding
            }
          >
            {outstanding === 0
              ? `All ${writableRows.length} logged for the week ending ${formatShortDate(weekEnding)}.`
              : `${outstanding} of ${writableRows.length} still to log for the week ending ${formatShortDate(weekEnding)}.`}
          </p>
          <button
            type="button"
            className={uiStyles.btnPrimary}
            onClick={save}
            disabled={pending}
          >
            {pending ? "Saving…" : "Save this week"}
          </button>
        </div>
      ) : null}

      {message ? (
        <p className={message.ok ? styles.successMessage : styles.errorMessage}>
          {message.text}
        </p>
      ) : null}

      <div className={styles.gridScroll} ref={scrollRef}>
        <table className={styles.grid}>
          <thead>
            <tr>
              {/* rowSpan, so the week-label row below carries only
                  week labels. Repeating these as empty cells left a
                  tall blank band across the top of the table. */}
              <th
                scope="col"
                rowSpan={2}
                className={`${styles.gridPin} ${styles.gridPinArea}`}
              >
                Functional Area
              </th>
              <th
                scope="col"
                rowSpan={2}
                className={`${styles.gridPin} ${styles.gridPinOwner}`}
              >
                Owner
              </th>
              <th
                scope="col"
                rowSpan={2}
                className={`${styles.gridPin} ${styles.gridPinName}`}
              >
                Critical Success Factor
              </th>
              <th
                scope="col"
                rowSpan={2}
                className={`${styles.gridPin} ${styles.gridPinFreq}`}
              >
                Frequency
              </th>
              <th
                scope="col"
                rowSpan={2}
                className={`${styles.gridPin} ${styles.gridPinTarget}`}
              >
                Target
              </th>
              {data.months.map((m) =>
                openMonths.has(m.key) ? (
                  <th
                    key={m.key}
                    scope="colgroup"
                    colSpan={m.weeks.length}
                    className={styles.gridMonthOpen}
                  >
                    <button
                      type="button"
                      className={styles.gridMonthButton}
                      onClick={() => toggleMonth(m.key)}
                      aria-expanded
                    >
                      <span aria-hidden>▾</span> {m.label}
                    </button>
                  </th>
                ) : (
                  <th
                    key={m.key}
                    scope="col"
                    rowSpan={2}
                    className={styles.gridMonthClosed}
                  >
                    <button
                      type="button"
                      className={styles.gridMonthButton}
                      onClick={() => toggleMonth(m.key)}
                      aria-expanded={false}
                    >
                      <span aria-hidden>▸</span> {m.label}
                    </button>
                  </th>
                )
              )}
            </tr>
            <tr>
              {data.months
                .filter((m) => openMonths.has(m.key))
                .flatMap((m) =>
                  m.weeks.map((w) => (
                    <th key={w} scope="col" className={styles.gridWeekHead}>
                      {w.slice(8)}
                    </th>
                  ))
                )}
            </tr>
          </thead>
          <tbody>
            {data.groups
              .filter((g) => g.rows.length > 0)
              .map((group) =>
                group.rows.map((row, i) => (
                  <tr key={row.id}>
                    {/* Written once per group, spanning its rows, the
                        way the merged Owner and Functional Area cells
                        in the spreadsheet already read. */}
                    {i === 0 ? (
                      <>
                        <th
                          scope="rowgroup"
                          rowSpan={group.rows.length}
                          className={`${styles.gridPin} ${styles.gridPinArea} ${styles.gridAreaCell}`}
                        >
                          <Link
                            href={`/chart/function/${group.functionId}`}
                            className={styles.fnTitleLink}
                          >
                            {group.functionTitle}
                          </Link>
                        </th>
                        <td
                          rowSpan={group.rows.length}
                          className={`${styles.gridPin} ${styles.gridPinOwner} ${styles.gridOwnerCell}`}
                        >
                          {group.ownerName ?? (
                            <span className={styles.gridNoOwner}>No Lead</span>
                          )}
                        </td>
                      </>
                    ) : null}
                    <th
                      scope="row"
                      className={`${styles.gridPin} ${styles.gridPinName} ${styles.gridNameCell}`}
                    >
                      {row.description}
                      <ExternalMeasureNote measureId={row.id} />
                      {authoring ? (
                        <span className={styles.gridRowActions}>
                          <button
                            type="button"
                            className={styles.gridEditLink}
                            onClick={() =>
                              setEditing((cur) => (cur === row.id ? null : row.id))
                            }
                            aria-expanded={editing === row.id}
                          >
                            {editing === row.id ? "Close" : "Edit"}
                          </button>
                          <ArchiveMeasureButton measureId={row.id} />
                        </span>
                      ) : null}
                    </th>
                    <td className={`${styles.gridPin} ${styles.gridPinFreq} ${styles.gridFreqCell}`}>
                      {row.frequencyLabel}
                    </td>
                    <td className={`${styles.gridPin} ${styles.gridPinTarget} ${styles.gridTargetCell}`}>
                      {row.target ? (
                        <>
                          <span className={styles.gridDir} aria-hidden>
                            {row.direction === "higher_is_better" ? "≥" : "≤"}
                          </span>{" "}
                          {row.target}
                        </>
                      ) : (
                        <span className={styles.gridNoTarget}>Not set</span>
                      )}
                    </td>
                    {columns.map((col) =>
                      col.kind === "month" ? (
                        <td
                          key={`${row.id}-${col.key}`}
                          className={styles.gridClosedCell}
                        />
                      ) : (
                        <GridCellView
                          key={`${row.id}-${col.key}`}
                          row={row}
                          week={col.key}
                          isCurrent={col.key === weekEnding}
                          canLog={group.canLog && trackingEnabled}
                          value={values[row.id] ?? ""}
                          onChange={(v) =>
                            setValues((prev) => ({ ...prev, [row.id]: v }))
                          }
                          disabled={pending}
                        />
                      )
                    )}
                  </tr>
                )).flatMap((tr, i) => {
                  const row = group.rows[i];
                  if (editing !== row.id) return [tr];
                  return [
                    tr,
                    // A FULL-WIDTH ROW, not a cell inside the name
                    // column. The pinned columns are narrow by design
                    // and a form inside one of them stretches the
                    // track until every measure's name wraps a word
                    // per line, which is the bug the old row's
                    // settings strip was written to avoid.
                    <tr key={`${row.id}-edit`} className={styles.gridEditRow}>
                      <td colSpan={5 + columns.length}>
                        <EditMeasureForm
                          measure={{
                            id: row.id,
                            description: row.description,
                            target: row.target,
                            value_type: row.valueType,
                            target_direction: row.direction,
                            update_frequency: row.frequency,
                            auto_track: row.autoTrack,
                          }}
                          outcomeTitle={row.description}
                          outcomeDescription={row.detail}
                          trackingEnabled={trackingEnabled}
                          onDone={() => setEditing(null)}
                        />
                      </td>
                    </tr>,
                  ];
                })
              )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GridCellView({
  row,
  week,
  isCurrent,
  canLog,
  value,
  onChange,
  disabled,
}: {
  row: GridRow;
  week: string;
  isCurrent: boolean;
  canLog: boolean;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const cell = row.cells.find((c) => c.weekEnding === week);
  const change = row.targetChanges.get(week);

  // Not expected: render nothing at all. Not a dash, not a zero, not
  // a muted dot. A monthly row is blank three weeks in four and any
  // mark in those cells reads as a week somebody skipped.
  if (!cell || !cell.expected) {
    return <td className={styles.gridNotDue} aria-hidden />;
  }

  const className = [
    styles.gridCell,
    styles[`gridCell_${cell.status}`],
    change ? styles.gridCellTargetMoved : "",
  ]
    .filter(Boolean)
    .join(" ");

  const title = change
    ? `Target changed from ${change.from ?? "none"} to ${change.to ?? "none"}`
    : cell.target
      ? `Target ${cell.target} this week`
      : undefined;

  if (isCurrent && canLog) {
    return (
      <td className={className} title={title}>
        <input
          className={styles.gridInput}
          type={row.valueType === "text" ? "text" : "number"}
          inputMode={row.valueType === "text" ? undefined : "decimal"}
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={`${row.description}, week ending ${week}`}
        />
      </td>
    );
  }

  return (
    <td className={className} title={title}>
      {cell.displayValue || <span className={styles.gridEmpty} aria-hidden />}
    </td>
  );
}

function isDueThisWeek(row: GridRow, weekEnding: string): boolean {
  return row.cells.find((c) => c.weekEnding === weekEnding)?.expected ?? false;
}

function currentValueOf(row: GridRow, weekEnding: string): string {
  const cell = row.cells.find((c) => c.weekEnding === weekEnding);
  if (!cell?.value) return "";
  if (row.valueType === "text") return cell.value.text ?? "";
  if (cell.value.number == null || !Number.isFinite(cell.value.number)) return "";
  return String(cell.value.number);
}
