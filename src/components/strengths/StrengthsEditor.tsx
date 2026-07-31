"use client";

import { useActionState, useState } from "react";
import {
  saveUserStrengthsAction,
  type SaveStrengthsResult,
  type UserStrengthsView,
} from "@/lib/strengths/user-strengths";
import { useStayOpenForm } from "@/lib/hooks/use-stay-open-form";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import styles from "@/app/(app)/admin/companies/admin.module.css";

// Editor for a user's strengths + superpowers. Used on /profile
// (self-edit) and on /people/[id]/strengths (admin editing a
// teammate). Semantics are replace-all — the form values become the
// full set for that user.

const INITIAL: SaveStrengthsResult = { ok: false, message: "" };

export function StrengthsEditor({
  userId,
  initial,
  heading = "Strengths & superpowers",
}: {
  userId: string;
  initial: UserStrengthsView;
  heading?: string;
}) {
  const [state, formAction, pending] = useActionState<
    SaveStrengthsResult,
    FormData
  >(saveUserStrengthsAction, INITIAL);

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok)
  );

  const [strengths, setStrengths] = useState<string[]>(
    initial.strengths.length > 0 ? initial.strengths.map((s) => s.label) : [""]
  );
  const [superpowers, setSuperpowers] = useState<string[]>(
    initial.superpowers.length > 0
      ? initial.superpowers.map((s) => s.label)
      : [""]
  );

  // Editing a row: if typing into the trailing empty row, a fresh
  // empty row appears below so the user never needs an "Add" button —
  // the last row is always in edit mode. Idempotent: no auto-append
  // when they're just editing an earlier row.
  function update(list: string[], idx: number, value: string) {
    const next = list.slice();
    next[idx] = value;
    const isLast = idx === next.length - 1;
    if (isLast && value.trim() !== "") next.push("");
    return next;
  }

  function removeAt(list: string[], idx: number) {
    const next = list.slice();
    next.splice(idx, 1);
    // Always keep at least one editable row.
    if (next.length === 0 || next[next.length - 1].trim() !== "") {
      next.push("");
    }
    return next;
  }

  return (
    <form action={formAction} className={styles.form} ref={formRef}>
      <input type="hidden" name="user_id" value={userId} />

      {heading ? <h3 className={styles.h3}>{heading}</h3> : null}

      <fieldset className={`${styles.field} ${styles.formFull}`}>
        <legend className={styles.label}>Strengths</legend>
        {strengths.map((value, idx) => (
          <StrengthRow
            key={`s-${idx}`}
            name="strength_label"
            value={value}
            placeholder="e.g. Strategic thinking"
            disabled={pending}
            onChange={(v) => setStrengths((prev) => update(prev, idx, v))}
            onRemove={() => setStrengths((prev) => removeAt(prev, idx))}
          />
        ))}
      </fieldset>

      <fieldset className={`${styles.field} ${styles.formFull}`}>
        <legend className={styles.label}>Superpowers</legend>
        {superpowers.map((value, idx) => (
          <StrengthRow
            key={`p-${idx}`}
            name="superpower_label"
            value={value}
            placeholder="e.g. Reading a room"
            disabled={pending}
            onChange={(v) => setSuperpowers((prev) => update(prev, idx, v))}
            onRemove={() => setSuperpowers((prev) => removeAt(prev, idx))}
          />
        ))}
      </fieldset>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <ConfirmationChip visible={confirmationVisible} label="Saved" />
      </div>
    </form>
  );
}

function StrengthRow({
  name,
  value,
  placeholder,
  disabled,
  onChange,
  onRemove,
}: {
  name: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
      <input
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={styles.input}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={120}
      />
      <button
        type="button"
        className={styles.ghostButton}
        onClick={onRemove}
        disabled={disabled}
        aria-label="Remove entry"
      >
        Remove
      </button>
    </div>
  );
}
