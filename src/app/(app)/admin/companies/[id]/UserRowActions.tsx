"use client";

import { useState, useTransition } from "react";
import { sendInviteAction, deleteUserAction } from "@/lib/auth/users";
import type { ProfileStatus } from "@/lib/types";
import styles from "../admin.module.css";

// Per-row send-invite + delete for the roster on /admin/companies/[id]
// and /people. Buttons stay responsive without a full-page reload.

export function UserRowActions({
  profileId,
  status,
  canDelete,
}: {
  profileId: string;
  status: ProfileStatus;
  canDelete: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const inviteLabel = status === "pending" ? "Send invite" : "Resend invite";

  function handleSend() {
    startTransition(async () => {
      const result = await sendInviteAction(profileId);
      setMessage(
        result.ok ? "Invite sent." : result.message ?? "Couldn't send invite."
      );
    });
  }

  function handleDelete() {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deleteUserAction(profileId);
      if (!result.ok) setMessage(result.message ?? "Couldn't delete.");
    });
  }

  return (
    <div className={styles.actionsCell}>
      <button
        type="button"
        className={styles.ghostButton}
        onClick={handleSend}
        disabled={pending}
      >
        {pending ? "Working…" : inviteLabel}
      </button>
      {canDelete ? (
        <button
          type="button"
          className={styles.dangerButton}
          onClick={handleDelete}
          disabled={pending}
        >
          Delete
        </button>
      ) : null}
      {message ? (
        <p role="status" className={styles.rowFootnote}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
