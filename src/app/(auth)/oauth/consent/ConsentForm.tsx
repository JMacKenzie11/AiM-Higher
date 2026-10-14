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
      {canApprove ? (
        <form action={approve}>
          <input type="hidden" name="authorization_id" value={authorizationId} />
          <button type="submit" className={formStyles.submit} disabled={pending} data-loading={approving ? "true" : undefined}>
            {approving ? "Connecting…" : "Allow"}
          </button>
        </form>
      ) : null}
      <form action={decline}>
        <input type="hidden" name="authorization_id" value={authorizationId} />
        <button type="submit" className={styles.decline} disabled={pending}>
          {declining ? "Declining…" : "Decline"}
        </button>
      </form>
      {message ? (
        <div role="alert" className={formStyles.errorMessage}>
          <p>{message}</p>
        </div>
      ) : null}
    </div>
  );
}
