"use client";

import { useEffect, useRef } from "react";
import styles from "./CompleteConfirmDialog.module.css";

// Small modal used to confirm cascade-Complete actions on Goals /
// Priorities and the bulk "Start new planning session" action on the
// Plan page. Focus is trapped inside; Escape or backdrop click cancels.

export type CompleteConfirmDialogProps = {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function CompleteConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  destructive = false,
  pending,
  onConfirm,
  onCancel,
}: CompleteConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="complete-dialog-title"
      onClick={() => {
        if (!pending) onCancel();
      }}
    >
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="complete-dialog-title" className={styles.title}>
          {title}
        </h2>
        <div className={styles.body}>{body}</div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.ghost}
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={destructive ? styles.danger : styles.primary}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
