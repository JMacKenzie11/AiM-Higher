"use client";

import { useState, useTransition } from "react";
import { setCommitmentClarityAction } from "@/lib/commitments/actions";
import type { Commitment } from "@/lib/types";
import styles from "./commitments.module.css";

// "Is this commitment clear?" against the two AiMS criteria:
//   timeline — deadline is clearly stated
//   success  — definition of done is well-defined
//
// Each is a boolean in the DB; null means "not yet assessed" (a
// meaningful third state, not the same as false). Both the analyzer
// (on transcript ingest) and the owner/admin (via ClarityEditor)
// can populate the fields.

export type ClarityState = "clear" | "unclear" | "unassessed";

export function clarityState(
  c: Pick<Commitment, "clarity_timeline" | "clarity_success">
): ClarityState {
  const parts = [c.clarity_timeline, c.clarity_success];
  if (parts.every((p) => p === true)) return "clear";
  if (parts.some((p) => p === false)) return "unclear";
  return "unassessed";
}

// Small colored dot sitting to the left of the description, used
// as an at-a-glance signal of clarity health. Clickable when the
// caller can edit; otherwise renders as a static span so team
// members still see the state.
export function ClarityChip({
  state,
  onClick,
}: {
  state: ClarityState;
  onClick?: () => void;
}) {
  const label =
    state === "clear"
      ? "Clear — both criteria met (timeline + success)"
      : state === "unclear"
        ? "Unclear — at least one criterion not met. Click to review."
        : "Not yet assessed for clarity. Click to review.";
  const className =
    state === "clear"
      ? styles.clarityDotClear
      : state === "unclear"
        ? styles.clarityDotUnclear
        : styles.clarityDotUnassessed;

  if (!onClick) {
    return (
      <span
        className={`${styles.clarityDot} ${className}`}
        title={label}
        aria-label={label}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.clarityDot} ${styles.clarityDotButton} ${className}`}
      title={label}
      aria-label={label}
    />
  );
}

// Three-checkbox inline editor + optional note. Reuses the shared
// resolveStrip look so it stacks with the reschedule / close strips
// visually. Save calls setCommitmentClarityAction.
export function ClarityEditor({
  commitment,
  onCancel,
  onSaved,
  onError,
}: {
  commitment: Commitment;
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [timeline, setTimeline] = useState<boolean | null>(
    commitment.clarity_timeline
  );
  const [success, setSuccess] = useState<boolean | null>(
    commitment.clarity_success
  );
  const [note, setNote] = useState<string>(commitment.clarity_note ?? "");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await setCommitmentClarityAction(commitment.id, {
        timeline,
        success,
        note: note.trim() ? note.trim() : null,
      });
      if (!result.ok) {
        onError(result.message);
      } else {
        onSaved();
      }
    });
  }

  return (
    <div className={styles.resolveStrip}>
      <span className={styles.stripLabel}>Clarity check</span>
      <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>
        A clear commitment names a stated deadline and an observable
        definition of done. Toggle each below.
      </p>
      <ClarityToggle
        label="Timeline is clear"
        value={timeline}
        onChange={setTimeline}
        disabled={pending}
      />
      <ClarityToggle
        label="Definition of done is well-defined"
        value={success}
        onChange={setSuccess}
        disabled={pending}
      />
      <label className={styles.stripLabel} htmlFor={`note-${commitment.id}`}>
        Refinement note (optional)
      </label>
      <textarea
        id={`note-${commitment.id}`}
        className={styles.stripTextarea}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="A one-liner rewording that would make this crystal clear."
        disabled={pending}
      />
      <div className={styles.stripSubmitRow}>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={submit}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save clarity"}
        </button>
      </div>
    </div>
  );
}

// Three-state toggle: unset (grey) → yes (green) → no (amber) → unset…
// Cycling through keeps the interaction one-click per state without
// hiding the "unassessed" case behind a separate control.
function ClarityToggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  disabled: boolean;
}) {
  const stateLabel =
    value === true ? "Yes" : value === false ? "No" : "Unset";
  const className =
    value === true
      ? styles.clarityBtnYes
      : value === false
        ? styles.clarityBtnNo
        : styles.clarityBtnUnset;
  function cycle() {
    if (value === null) onChange(true);
    else if (value === true) onChange(false);
    else onChange(null);
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
      }}
    >
      <button
        type="button"
        onClick={cycle}
        disabled={disabled}
        className={`${styles.clarityBtn} ${className}`}
        aria-label={`${label}: ${stateLabel}. Click to change.`}
      >
        {stateLabel}
      </button>
      <span style={{ fontSize: "13px", color: "var(--text)" }}>{label}</span>
    </div>
  );
}
