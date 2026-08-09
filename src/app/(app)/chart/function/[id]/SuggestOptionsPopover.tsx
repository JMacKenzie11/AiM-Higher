"use client";

import { useEffect, useState, useTransition } from "react";
import { suggestForFunctionAction } from "@/lib/role-descriptions/actions";
import type {
  Recommendation,
  RdTarget,
} from "@/lib/role-descriptions/recommend";
import styles from "../../chart.module.css";

// Inline "Suggest options" popover for the RD-enabled chart sections.
// Replaces the earlier full-drawer interview: each section owns its
// own suggestion path, cards are self-contained (Use writes directly
// through the caller's onSave, Edit becomes an inline edit form on
// the card, Skip dismisses). No draft state has to be lifted out of
// the section's inline add-row.
//
// The button is a compact secondary pill. When open, the popover
// slides in a short list of cards below the button. Regenerate
// re-fires the recommend call; Close hides everything.

type SaveResult = { ok: true } | { ok: false; message: string };

export function SuggestOptionsPopover({
  functionId,
  target,
  outcomeId,
  buttonLabel = "Suggest options",
  hideCardBody = false,
  onSave,
}: {
  functionId: string;
  target: RdTarget;
  outcomeId?: string;
  buttonLabel?: string;
  // When true, the suggestion card renders just title + rationale
  // (no middle body line) and edit mode only exposes the title.
  // On Save, body is passed as null so we don't quietly persist
  // something the user never saw. Used by R&R where body =
  // sub-areas and the card reads cleaner without it.
  hideCardBody?: boolean;
  onSave: (title: string, body: string | null) => Promise<SaveResult>;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Recommendation[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [pending, startFetch] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (open && !hasFetched && !pending) {
      fetchSuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function fetchSuggestions() {
    setError(null);
    setDismissed(new Set());
    startFetch(async () => {
      const result = await suggestForFunctionAction({
        functionId,
        target,
        outcomeId,
      });
      setHasFetched(true);
      if (!result.ok) {
        setSuggestions([]);
        setError(result.message);
        return;
      }
      if (result.recommendations.length === 0) {
        setSuggestions([]);
        setError("No suggestions this time. Try again or add one yourself.");
        return;
      }
      setSuggestions(result.recommendations);
    });
  }

  function regenerate() {
    setSuggestions([]);
    setHasFetched(false);
    fetchSuggestions();
  }

  function close() {
    setOpen(false);
    setSuggestions([]);
    setHasFetched(false);
    setError(null);
    setDismissed(new Set());
  }

  function dismissCard(i: number) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(i);
      return next;
    });
  }

  const visibleCards = suggestions
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => !dismissed.has(i));

  return (
    <div className={styles.suggestWrap}>
      <button
        type="button"
        className={styles.suggestButton}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {buttonLabel}
      </button>

      {open ? (
        <div className={styles.suggestPanel} role="region" aria-label="Suggestions">
          <div className={styles.suggestPanelHeader}>
            <span className={styles.suggestPanelLabel}>Suggestions</span>
            <button
              type="button"
              className={styles.suggestPanelClose}
              onClick={close}
              aria-label="Close suggestions"
            >
              ×
            </button>
          </div>

          {pending ? (
            <p className={styles.suggestMuted}>Thinking…</p>
          ) : error ? (
            <p role="alert" className={styles.suggestError}>
              {error}
            </p>
          ) : visibleCards.length === 0 && hasFetched ? (
            <p className={styles.suggestMuted}>
              All suggestions dismissed. Try again for fresh options.
            </p>
          ) : (
            <div className={styles.suggestList}>
              {visibleCards.map(({ s, i }) => (
                <SuggestionCard
                  key={i}
                  rec={s}
                  hideBody={hideCardBody}
                  onSave={onSave}
                  onDismiss={() => dismissCard(i)}
                />
              ))}
            </div>
          )}

          <div className={styles.suggestPanelFooter}>
            <button
              type="button"
              className={styles.suggestSecondary}
              onClick={regenerate}
              disabled={pending}
            >
              {pending ? "Thinking…" : "Suggest 3 more"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SuggestionCard({
  rec,
  hideBody,
  onSave,
  onDismiss,
}: {
  rec: Recommendation;
  hideBody: boolean;
  onSave: (title: string, body: string | null) => Promise<SaveResult>;
  onDismiss: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(rec.title);
  const [body, setBody] = useState(rec.body ?? "");
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(nextTitle: string, nextBody: string | null) {
    if (!nextTitle.trim()) return;
    setError(null);
    startSave(async () => {
      // When the card hides body, don't quietly persist an
      // auto-generated body the user never saw — pass null.
      const bodyToSave = hideBody ? null : nextBody?.trim() || null;
      const result = await onSave(nextTitle.trim(), bodyToSave);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDismiss();
    });
  }

  return (
    <article className={styles.suggestCard}>
      {editing ? (
        <>
          <input
            type="text"
            className={styles.suggestEditInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
            autoFocus
            aria-label="Edit title"
          />
          {hideBody ? null : (
            <textarea
              className={styles.suggestEditTextarea}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              disabled={saving}
              aria-label="Edit body"
            />
          )}
        </>
      ) : (
        <>
          <h4 className={styles.suggestCardTitle}>{rec.title}</h4>
          {!hideBody && rec.body ? (
            <p className={styles.suggestCardBody}>{rec.body}</p>
          ) : null}
          {rec.rationale ? (
            <p className={styles.suggestCardRationale}>{rec.rationale}</p>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className={styles.suggestError}>
          {error}
        </p>
      ) : null}
      <div className={styles.suggestCardActions}>
        {editing ? (
          <>
            <button
              type="button"
              className={styles.suggestPrimary}
              onClick={() => save(title, body || null)}
              disabled={saving || !title.trim()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={styles.suggestGhost}
              onClick={() => {
                setEditing(false);
                setTitle(rec.title);
                setBody(rec.body ?? "");
                setError(null);
              }}
              disabled={saving}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={styles.suggestPrimary}
              onClick={() => save(rec.title, rec.body)}
              disabled={saving}
            >
              {saving ? "Saving…" : "Use this"}
            </button>
            <button
              type="button"
              className={styles.suggestSecondary}
              onClick={() => setEditing(true)}
              disabled={saving}
            >
              Edit
            </button>
            <button
              type="button"
              className={styles.suggestGhost}
              onClick={onDismiss}
              disabled={saving}
            >
              Skip
            </button>
          </>
        )}
      </div>
    </article>
  );
}
