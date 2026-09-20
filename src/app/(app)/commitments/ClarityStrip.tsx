"use client";

import type { Commitment } from "@/lib/types";
import styles from "./commitments.module.css";

// "Is this commitment clear?" against the two AiMS criteria:
//   timeline — deadline is clearly stated
//   success  — definition of done is well-defined
//
// Each is a boolean in the DB; null means "not yet assessed" (a
// meaningful third state, not the same as false). Both the analyzer
// (on transcript ingest) and the owner/admin can populate the
// fields; the owner/admin path is ClarityDrawer, which owns the only
// use of ClarityToggle below. The editor used to live here and
// render inline inside the row — see ClarityDrawer for why it does
// not any more.

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

// Three-state toggle: unset (grey) → yes (green) → no (amber) → unset…
// Cycling through keeps the interaction one-click per state without
// hiding the "unassessed" case behind a separate control.
export function ClarityToggle({
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
