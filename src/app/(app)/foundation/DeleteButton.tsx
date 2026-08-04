"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import styles from "./foundation.module.css";

// Generic delete button used by every deletable row on /foundation.
//
// Server actions can only cross the Server-→Client boundary as bare
// references (or `.bind()`-partialled server actions). Passing an
// anonymous `async () => action(id)` wrapper from the Server Component
// fails serialization. So this component takes the server action + the
// id it should operate on as two separate props, and invokes them here.

export function DeleteButton({
  action,
  itemId,
  confirmMessage = "Delete this item?",
  label = "Delete",
}: {
  action: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  itemId: string;
  // Kept as `confirmMessage` for API compatibility with existing
  // callers on /foundation. Used as the ConfirmDialog title so a
  // question like "Delete this metric?" reads correctly.
  confirmMessage?: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function run() {
    setConfirming(false);
    setError(null);
    startTransition(async () => {
      const result = await action(itemId);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        className={styles.dangerGhostButton}
        onClick={() => setConfirming(true)}
        disabled={pending}
      >
        {pending ? "…" : label}
      </button>
      {error ? (
        <span role="alert" className={styles.deleteError}>
          {error}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={confirmMessage}
        message="This can't be undone."
        confirmLabel={label}
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
    </>
  );
}
