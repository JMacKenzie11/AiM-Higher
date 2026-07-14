"use client";

import { useState, useTransition } from "react";
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
  confirmMessage = "Delete this?",
  label = "Delete",
}: {
  action: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  itemId: string;
  confirmMessage?: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (!confirm(confirmMessage)) return;
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
        onClick={onClick}
        disabled={pending}
      >
        {pending ? "…" : label}
      </button>
      {error ? (
        <span role="alert" className={styles.deleteError}>
          {error}
        </span>
      ) : null}
    </>
  );
}
