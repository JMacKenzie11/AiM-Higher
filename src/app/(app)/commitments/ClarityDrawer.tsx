"use client";

import { useEffect, useState, useTransition } from "react";
import { setCommitmentClarityAction } from "@/lib/commitments/actions";
import type { Commitment } from "@/lib/types";
import { Drawer } from "@/components/ui/Drawer";
import { ClarityToggle } from "./ClarityStrip";
import styles from "./commitments.module.css";

// The clarity check, in a drawer.
//
// It used to render inline as a direct child of `.row` — the same
// grid whose cells are placed by child position, and the same grid
// that produced the add-line collapse in E15. On a phone it roughly
// doubled the height of the card it belonged to, so the list you
// were working down reflowed under your thumb every time you scored
// one commitment.
//
// Through a portal to document.body, so it is not a grid item at
// all. That is not cosmetic: `position: fixed` resolves against the
// nearest ancestor with a transform, filter or perspective, and the
// rows this opens from are inside cards that have all three at
// various breakpoints. ConfirmDialog has the same note for the same
// reason.
//
// /issues renders the same CommitmentRow as /commitments, so this
// lands on both pages at once.

export function ClarityDrawer({
  commitment,
  open,
  onClose,
  onSaved,
}: {
  commitment: Commitment;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [timeline, setTimeline] = useState<boolean | null>(
    commitment.clarity_timeline
  );
  const [success, setSuccess] = useState<boolean | null>(
    commitment.clarity_success
  );
  const [note, setNote] = useState<string>(commitment.clarity_note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-seed from the row every time it opens. The drawer outlives a
  // single open now that it is mounted outside the row, so a save
  // followed by a reopen must show what was saved, not the state the
  // component was first constructed with.
  useEffect(() => {
    if (!open) return;
    setTimeline(commitment.clarity_timeline);
    setSuccess(commitment.clarity_success);
    setNote(commitment.clarity_note ?? "");
    setError(null);
  }, [
    open,
    commitment.clarity_timeline,
    commitment.clarity_success,
    commitment.clarity_note,
  ]);

  const initialNote = commitment.clarity_note ?? "";
  const isDirty =
    timeline !== commitment.clarity_timeline ||
    success !== commitment.clarity_success ||
    note.trim() !== initialNote.trim();

  function submit() {
    startTransition(async () => {
      const result = await setCommitmentClarityAction(commitment.id, {
        timeline,
        success,
        note: note.trim() ? note.trim() : null,
      });
      if (!result.ok) setError(result.message);
      else onSaved();
    });
  }

  const bothYes = timeline === true && success === true;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Commitment"
      title="Clarity check"
      footer={
        <>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={onClose}
            disabled={pending}
          >
            {isDirty ? "Cancel" : "Close"}
          </button>
          {isDirty ? (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={submit}
              disabled={pending}
            >
              {pending ? "Saving…" : "Save clarity"}
            </button>
          ) : null}
        </>
      }
    >
      <div className={styles.clarityBody}>
        {/* Behind a scrim you cannot see the row any more, so the
            commitment comes with you. */}
        <p className={styles.drawerQuote}>{commitment.description}</p>

        <p className={styles.drawerHint}>
          A clear commitment has a deadline that was explicitly agreed,
          not a placeholder filled in for it, and a definition of done
          somebody else could check.
        </p>

        <ClarityToggle
          label="Deadline was explicitly agreed"
          value={timeline}
          onChange={setTimeline}
          disabled={pending}
        />
        <ClarityToggle
          label="Definition of done is observable"
          value={success}
          onChange={setSuccess}
          disabled={pending}
        />

        {/* Only when something is off. A commitment that passes both
            checks does not need rewording, and an empty box asking
            for one reads as unfinished work. */}
        {!bothYes ? (
          <>
            <label
              className={styles.stripLabel}
              htmlFor={`note-${commitment.id}`}
            >
              Refinement note (optional)
            </label>
            <textarea
              id={`note-${commitment.id}`}
              className={styles.stripTextarea}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="A one-liner rewording that would make this crystal clear."
              disabled={pending}
            />
          </>
        ) : null}

        {error ? (
          <p role="alert" className={styles.drawerError}>
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
