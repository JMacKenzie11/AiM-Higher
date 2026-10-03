"use client";

import { useState, useTransition } from "react";
import { removeConnectionAction } from "@/lib/connections/actions";
import type { Connector } from "@/lib/connections/vault";
import styles from "../../admin.module.css";

// Disconnect, with the consequence said before it happens. The stored
// secret is deleted; connecting again starts from nothing.
export function DisconnectButton({
  companyId,
  connector,
  consequence,
}: {
  companyId: string;
  connector: Connector;
  consequence: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (message?.ok) {
    return (
      <p role="status" className={styles.successMessage}>
        {message.text}
      </p>
    );
  }

  if (!confirming) {
    return (
      <button type="button" className={styles.ghostButton} onClick={() => setConfirming(true)}>
        Disconnect
      </button>
    );
  }

  return (
    <div className={styles.warningMessage} role="group" aria-label="Confirm disconnect">
      <p>{consequence} The saved key is deleted.</p>
      {message ? (
        <p role="alert" className={styles.errorMessage}>
          {message.text}
        </p>
      ) : null}
      <div className={styles.rowActions}>
        <button
          type="button"
          className={styles.dangerButton}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await removeConnectionAction(companyId, connector);
              setMessage({ ok: r.ok, text: r.message });
            })
          }
        >
          {pending ? "Disconnecting…" : "Disconnect"}
        </button>
        <button type="button" className={styles.ghostButton} onClick={() => setConfirming(false)} disabled={pending}>
          Keep it connected
        </button>
      </div>
    </div>
  );
}
