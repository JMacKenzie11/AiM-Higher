"use client";

import { useState, useTransition } from "react";
import { archiveConversationAction } from "@/lib/coach/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import styles from "../coach.module.css";

export function ArchiveConversationButton({
  conversationId,
}: {
  conversationId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setConfirmOpen(false);
    setError(null);
    startTransition(async () => {
      const result = await archiveConversationAction(conversationId);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        className={styles.ghostButton}
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
      >
        {pending ? "…" : "Archive"}
      </button>
      {error ? (
        <span role="alert" style={{ color: "var(--aims-danger)", fontSize: 12 }}>
          {error}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        title="Archive this conversation?"
        message="It disappears from the list. The messages stay on file for the caller who owns the thread."
        confirmLabel="Archive"
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirmOpen(false)}
        pending={pending}
      />
    </>
  );
}
