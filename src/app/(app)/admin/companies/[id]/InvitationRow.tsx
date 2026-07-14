"use client";

import { useState, useTransition } from "react";
import {
  resendInvitationAction,
  revokeInvitationAction,
} from "@/lib/auth/invitations";
import type { Invitation } from "@/lib/types";
import styles from "../admin.module.css";

// Client wrapper for the pending-invitation actions. Keeps buttons
// responsive and surfaces per-row status without a full-page reload.

export function InvitationRow({ invitation }: { invitation: Invitation }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const expiresText = new Date(invitation.expires_at).toLocaleDateString();

  function handleResend() {
    startTransition(async () => {
      const result = await resendInvitationAction(invitation.id);
      setMessage(
        result.ok ? "Invitation resent." : result.message ?? "Couldn't resend."
      );
    });
  }

  function handleRevoke() {
    startTransition(async () => {
      const result = await revokeInvitationAction(invitation.id);
      setMessage(
        result.ok ? "Invitation revoked." : result.message ?? "Couldn't revoke."
      );
    });
  }

  return (
    <tr>
      <td>{invitation.full_name}</td>
      <td>{invitation.email}</td>
      <td className={styles.capCell}>
        {invitation.role.replace("_", " ")}
      </td>
      <td>{expiresText}</td>
      <td>
        <div className={styles.actionsCell}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={handleResend}
            disabled={pending}
          >
            {pending ? "Working…" : "Resend"}
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            onClick={handleRevoke}
            disabled={pending}
          >
            Revoke
          </button>
        </div>
        {message ? (
          <p role="status" className={styles.rowFootnote}>
            {message}
          </p>
        ) : null}
      </td>
    </tr>
  );
}
