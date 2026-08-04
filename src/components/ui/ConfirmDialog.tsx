"use client";

import { useEffect, useRef } from "react";
import styles from "./ConfirmDialog.module.css";

// Branded confirmation dialog — replacement for native window.confirm().
// Native dialogs look unbranded, freeze the entire window (a real
// problem during screen-shared client meetings), and can't be styled
// or a11y-improved. This component gives us one shared shape for
// every "are you sure?" moment: destructive intent, kept intent, or
// neutral confirm.
//
// Usage: keep a piece of state in the caller for what to confirm,
// pass onConfirm/onCancel handlers, and render this component.
//
// Not a portal (the app has no portal setup today); the fixed
// positioning + high z-index handles the overlay.

export type ConfirmTone = "danger" | "primary";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  onCancel,
  pending = false,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Escape to cancel; auto-focus the safe (cancel) button so a
  // stray Enter keypress doesn't run the destructive action.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onCancel();
    }
    document.addEventListener("keydown", onKey);
    cancelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel, pending]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <div className={styles.dialog}>
        <h2 id="confirm-title" className={styles.title}>
          {title}
        </h2>
        {message ? <p className={styles.message}>{message}</p> : null}
        <div className={styles.actions}>
          <button
            ref={cancelRef}
            type="button"
            className={styles.cancel}
            onClick={onCancel}
            disabled={pending}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              tone === "danger" ? styles.confirmDanger : styles.confirmPrimary
            }
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
