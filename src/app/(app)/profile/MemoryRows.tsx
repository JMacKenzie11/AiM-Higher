"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  deleteMyMemoryAction,
  editMemoryAction,
  type MemoryListRow,
} from "@/lib/coach/memory-actions";
import { MAX_DIRECTED_MEMORY_CHARS, pageWindow } from "@/lib/coach/memory-shape";
import { memoryKindLabel, memoryKindClass } from "@/lib/coach/memory-kind";
import { formatShortDate } from "@/lib/dates";
import styles from "./memory-card.module.css";

// The memory table, shared by the profile card and the full list so
// the two are one object seen twice rather than two that resemble
// each other. They had already drifted once.
//
// COLUMN ORDER IS THE PRODUCT OWNER'S: edit, delete, kind, date,
// memory. The actions lead rather than trail, which is unusual for
// this app's tables and is the point — this is a page for acting on
// your own record, not for reading a roster, so the verbs come first
// and the prose runs to the edge.
// Ten at a time, paged in place.
//
// The card used to show five and then a "See all 9" link that
// navigated to a different page. Two problems with that: the number
// was a promise the link did not keep (it went to a page, not to the
// rest of the list), and leaving the profile to read your own memory
// is a detour on a surface whose whole job is letting you look at it.
// Paging here means the card IS the list.
export function MemoryRows({ rows }: { rows: MemoryListRow[] }) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<MemoryListRow | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  // WHICH ROW IS BUSY, not whether anything is.
  //
  // Every control was disabled on `pending`, so one slow save froze
  // the whole table: a person mid-read could not delete a different
  // line, and on a slow connection the page looked broken rather than
  // busy. It also made the E2E hang, which is how it was found —
  // the delete button it was waiting for was disabled by a refresh
  // belonging to a different row.
  const [busyId, setBusyId] = useState<string | null>(null);

  // Grow the box to its content instead of scrolling it.
  //
  // A memory is one sentence and most of them wrap; a single-line
  // input showed the tail and hid the beginning, which is the worst
  // possible view when the thing you are about to change is the
  // wording. Height is set from scrollHeight rather than guessed from
  // a character count, because wrapping depends on the column width
  // and that changes with the viewport.
  const fit = useCallback(() => {
    const el = editRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  function beginEdit(memory: MemoryListRow) {
    setEditingId(memory.id);
    setDraft(memory.content);
    setError(null);
    setDeclined(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
    setDeclined(null);
  }

  function saveEdit(memory: MemoryListRow) {
    const content = draft.trim();
    if (content.length === 0 || content === memory.content) {
      cancelEdit();
      return;
    }
    setBusyId(memory.id);
    startTransition(async () => {
      const result = await editMemoryAction(memory.id, content);
      if (result.ok) {
        cancelEdit();
        router.refresh();
      } else if (result.declined) {
        setDeclined(result.message);
      } else {
        setError(result.message);
      }
      setBusyId(null);
    });
  }

  function remove(memory: MemoryListRow) {
    setConfirming(null);
    setError(null);
    setBusyId(memory.id);
    startTransition(async () => {
      const result = await deleteMyMemoryAction(memory.id);
      if (!result.ok) setError(result.message);
      else router.refresh();
      setBusyId(null);
    });
  }

  // The arithmetic lives in memory-shape.ts, where its edge cases are
  // unit-tested: the one that strands somebody is deleting the last
  // row on the last page, which leaves this index past the end.
  const { pageCount, current, start, end, firstShown, lastShown } = pageWindow(
    rows.length,
    page
  );
  useEffect(() => {
    if (page !== current) setPage(current);
  }, [page, current]);
  const visible = useMemo(() => rows.slice(start, end), [rows, start, end]);

  return (
    <>
      {declined ? (
        <p className={styles.declined} role="status">
          {declined}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.actionHead}>Edit</th>
              <th className={styles.actionHead}>Delete</th>
              <th>Source</th>
              <th>Date</th>
              <th>Memory</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((memory) => {
              const isEditing = editingId === memory.id;
              const busy = busyId === memory.id;
              return (
                <tr key={memory.id} data-testid="memory-row" data-kind={memory.kind}>
                  <td className={styles.actionCell}>
                    {isEditing ? (
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => saveEdit(memory)}
                        disabled={busy}
                        aria-label={`Save: ${memory.content}`}
                        title="Save"
                      >
                        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
                          <path
                            d="M3 8.5 L6.5 12 L13 4.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.4}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => beginEdit(memory)}
                        disabled={busy}
                        aria-label={`Edit: ${memory.content}`}
                        title="Edit"
                      >
                        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
                          <path
                            d="M11.5 2.5 a1.4 1.4 0 0 1 2 2 L6 12 L3 13 L4 10 z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.4}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                  </td>
                  <td className={styles.actionCell}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() =>
                        isEditing ? cancelEdit() : setConfirming(memory)
                      }
                      disabled={busy}
                      aria-label={
                        isEditing ? "Cancel edit" : `Delete: ${memory.content}`
                      }
                      title={isEditing ? "Cancel" : "Delete"}
                    >
                      {isEditing ? (
                        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
                          <path
                            d="M4 4 L12 12 M12 4 L4 12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.4}
                            strokeLinecap="round"
                          />
                        </svg>
                      ) : (
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
                      )}
                    </button>
                  </td>
                  <td>
                    <span className={styles[memoryKindClass(memory.kind)]}>
                      {memoryKindLabel(memory.kind)}
                    </span>
                  </td>
                  <td className={styles.dateCell}>
                    {formatShortDate(memory.created_at.slice(0, 10))}
                    {memory.edited_at ? (
                      <span className={styles.editedNote}> · edited</span>
                    ) : null}
                  </td>
                  <td>
                    {isEditing ? (
                      <textarea
                        ref={(el) => {
                          editRef.current = el;
                          if (el) {
                            el.style.height = "auto";
                            el.style.height = `${el.scrollHeight}px`;
                          }
                        }}
                        className={styles.editInput}
                        value={draft}
                        rows={1}
                        maxLength={MAX_DIRECTED_MEMORY_CHARS}
                        autoFocus
                        aria-label="Edit memory"
                        onChange={(e) => {
                          setDraft(e.target.value);
                          setDeclined(null);
                          fit();
                        }}
                        onKeyDown={(e) => {
                          // Enter saves rather than inserting a line
                          // break: a memory is one sentence, and the
                          // box is a textarea for WRAPPING, not for
                          // writing paragraphs. Matches the add box
                          // directly above it.
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveEdit(memory);
                          }
                          if (e.key === "Escape") cancelEdit();
                        }}
                        disabled={busy}
                      />
                    ) : (
                      memory.content
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Only when there is more than one page. A pager under a
          five-row table is furniture reporting that there is nothing
          to page through. */}
      {pageCount > 1 ? (
        <div className={styles.pager}>
          <span className={styles.pagerCount}>
            {firstShown}&ndash;{lastShown} of {rows.length}
          </span>
          <div className={styles.pagerButtons}>
            <button
              type="button"
              className={styles.pagerButton}
              onClick={() => setPage(current - 1)}
              disabled={current === 0 || pending}
            >
              Previous
            </button>
            <button
              type="button"
              className={styles.pagerButton}
              onClick={() => setPage(current + 1)}
              disabled={current >= pageCount - 1 || pending}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        tone="danger"
        title="Delete this memory?"
        message={confirming?.content ?? ""}
        confirmLabel="Delete"
        onConfirm={() => confirming && remove(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
