"use client";

import Link from "next/link";
import { useEffect, useId, useState, useTransition } from "react";
import { parseCommitmentDraft } from "@/lib/coach/commitment-draft";
import {
  getDraftCardStateAction,
  saveCommitmentDraftAction,
  type DraftCardState,
} from "@/lib/coach/commitment-draft-actions";
import { BY_NEXT_MEETING } from "@/lib/commitments/due-label";
import { LinkPicker, type LinkSelection } from "@/app/(app)/commitments/LinkPicker";
import styles from "./CommitmentDraftCard.module.css";

// Aimee's draft of the leader's next step (coach/commitment-draft.ts).
//
// Nothing is saved until the leader presses Save (principles: "They see
// the draft and confirm it before anything is saved"). They can change
// the words, set a day or keep "By next meeting", and link it to a
// priority or a function, the same choices the Commitments page's add
// row offers. Saved once per card (0255): reloading shows it saved.
//
// Only the person who started the conversation can save; anyone else
// reading it (a sharee) sees the draft without the form.

export function CommitmentDraftCard({
  raw,
  streaming,
  conversationId,
  messageId,
}: {
  raw: string;
  streaming: boolean;
  conversationId: string;
  // The saved Aimee message; null until the reply has finished saving.
  messageId: string | null;
}) {
  const draft = parseCommitmentDraft(raw);
  const ids = useId();
  // undefined: not loaded yet. null: not this person's to save.
  const [state, setState] = useState<DraftCardState | null | undefined>(undefined);
  const [description, setDescription] = useState(draft?.description ?? "");
  const [dueDate, setDueDate] = useState<string | null>(draft?.dueDate ?? null);
  const [link, setLink] = useState<LinkSelection>({ priorityId: null, functionalAreaId: null });
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The draft arrives while the reply streams; take it once it is whole.
  const draftKey = draft ? `${draft.description}|${draft.dueDate ?? ""}` : "";
  useEffect(() => {
    if (!draft || streaming) return;
    setDescription(draft.description);
    setDueDate(draft.dueDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, streaming]);

  useEffect(() => {
    if (!messageId || streaming) return;
    let live = true;
    getDraftCardStateAction(conversationId, messageId)
      .then((s) => live && setState(s))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, [conversationId, messageId, streaming]);

  if (!draft) {
    return (
      <div className={styles.pending} role="status" aria-live="polite">
        {streaming ? "Writing the draft…" : "The draft did not come through this time. Ask Aimee to draft it again."}
      </div>
    );
  }

  if (state?.saved) {
    return (
      <article className={styles.card} data-testid="commitment-draft-card">
        <p className={styles.eyebrow}>Commitment</p>
        <div className={styles.saved} role="status">
          <p>
            <strong>Saved to your commitments.</strong>
          </p>
          <p>{state.saved.description}</p>
          <p>Due: {state.saved.due}</p>
          <p>
            <Link href="/commitments">Open Commitments</Link>
          </p>
        </div>
      </article>
    );
  }

  const canSave = !streaming && Boolean(messageId) && state !== undefined && state !== null;

  if (dismissed) {
    return (
      <article className={styles.card} data-testid="commitment-draft-card">
        <p className={styles.muted}>Not saved.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={() => setDismissed(false)}>
            Show the draft again
          </button>
        </div>
      </article>
    );
  }

  // Read-only: still arriving, not saved yet, or not theirs to save.
  if (!canSave) {
    return (
      <article className={styles.card} data-testid="commitment-draft-card">
        <p className={styles.eyebrow}>Draft commitment</p>
        <p className={styles.description}>{draft.description}</p>
        <p className={styles.muted}>Due: {draft.dueDate ?? BY_NEXT_MEETING}</p>
        {state === null && !streaming && messageId ? (
          <p className={styles.muted}>Only the person who started this conversation can save it.</p>
        ) : null}
      </article>
    );
  }

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveCommitmentDraftAction({
        conversationId,
        messageId: messageId as string,
        description,
        dueDate,
        priorityId: link.priorityId,
        functionalAreaId: link.functionalAreaId,
      });
      if (result.ok) setState({ ...state, saved: result.saved });
      else setError(result.message);
    });
  };

  const hasLinks = state.priorityOptions.length > 0 || state.functionalAreaOptions.length > 0;

  return (
    <article className={styles.card} data-testid="commitment-draft-card">
      <p className={styles.eyebrow}>Draft commitment</p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${ids}-what`}>
          What you&rsquo;ll do
        </label>
        <textarea
          id={`${ids}-what`}
          className={styles.text}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          disabled={pending}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.label} id={`${ids}-due`}>
          Due
        </span>
        {dueDate === null ? (
          <div className={styles.dueRow}>
            <span aria-labelledby={`${ids}-due`}>{BY_NEXT_MEETING}</span>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setDueDate(new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10))}
              disabled={pending}
            >
              Set a date
            </button>
          </div>
        ) : (
          <div className={styles.dueRow}>
            <input
              type="date"
              className={styles.date}
              aria-labelledby={`${ids}-due`}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value || null)}
              disabled={pending}
            />
            <button type="button" className={styles.linkButton} onClick={() => setDueDate(null)} disabled={pending}>
              Use {BY_NEXT_MEETING.toLowerCase()}
            </button>
          </div>
        )}
      </div>
      {hasLinks ? (
        <div className={styles.field}>
          <span className={styles.label}>Link (optional)</span>
          <LinkPicker
            priorityOptions={state.priorityOptions}
            functionalAreaOptions={state.functionalAreaOptions}
            value={link}
            onSelect={setLink}
            disabled={pending}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button type="button" className={styles.primaryButton} onClick={save} disabled={pending || !description.trim()}>
          {pending ? "Saving…" : "Save commitment"}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => setDismissed(true)} disabled={pending}>
          Not now
        </button>
      </div>
    </article>
  );
}
