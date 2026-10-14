"use client";

import { useActionState } from "react";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import styles from "./consent.module.css";
import {
  approveAssistantAction,
  declineAssistantAction,
  type ConsentResult,
} from "@/lib/mcp/consent-actions";

// Approve or decline an outside assistant's sign-in request. Approve is
// shown only to someone the switch admits; the action checks again.
export function ConsentForm({ authorizationId, canApprove }: { authorizationId: string; canApprove: boolean }) {
  const [approveState, approve, approving] = useActionState<ConsentResult | undefined, FormData>(
    approveAssistantAction,
    undefined
  );
  const [declineState, decline, declining] = useActionState<ConsentResult | undefined, FormData>(
    declineAssistantAction,
    undefined
  );
  const message = approveState?.message ?? declineState?.message ?? null;
  const pending = approving || declining;

  return (
    <div className={formStyles.form}>
      {/* One pair, the same size and shape: Decline outlined, Allow
          filled, with room above them so they read apart from the text. */}
      <div className={styles.actions}>
        <form action={decline} className={styles.actionForm}>
          <input type="hidden" name="authorization_id" value={authorizationId} />
          <button type="submit" className={`${styles.button} ${styles.decline}`} disabled={pending}>
            {declining ? "Declining…" : "Decline"}
          </button>
        </form>
        {canApprove ? (
          <form action={approve} className={styles.actionForm}>
            <input type="hidden" name="authorization_id" value={authorizationId} />
            <button
              type="submit"
              className={`${styles.button} ${styles.allow}`}
              disabled={pending}
              data-loading={approving ? "true" : undefined}
            >
              {approving ? "Connecting…" : "Allow"}
            </button>
          </form>
        ) : null}
      </div>
      {message ? (
        <div role="alert" className={formStyles.errorMessage}>
          <p>{message}</p>
        </div>
      ) : null}
    </div>
  );
}
