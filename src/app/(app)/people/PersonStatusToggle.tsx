"use client";

import { useState, useTransition } from "react";
import { setProfileStatusAction } from "@/lib/people/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import styles from "./people.module.css";

// Deactivate / reactivate an admin's teammate. Disabled on the acting
// user's own row so admins can't lock themselves out.

export function PersonStatusToggle({
  personId,
  currentStatus,
  disabled,
}: {
  personId: string;
  currentStatus: "active" | "inactive";
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function apply(next: "active" | "inactive") {
    setConfirming(false);
    startTransition(async () => {
      const result = await setProfileStatusAction(personId, next);
      if (!result.ok) setMessage(result.message);
    });
  }

  function onClick() {
    if (disabled) return;
    const next = currentStatus === "active" ? "inactive" : "active";
    if (next === "inactive") {
      setConfirming(true);
      return;
    }
    apply(next);
  }

  return (
    <div>
      <button
        type="button"
        className={
          currentStatus === "active"
            ? styles.dangerGhostButton
            : styles.ghostButton
        }
        onClick={onClick}
        disabled={pending || disabled}
        aria-label={
          currentStatus === "active" ? "Deactivate person" : "Reactivate person"
        }
      >
        {pending
          ? "Saving…"
          : currentStatus === "active"
            ? "Deactivate"
            : "Reactivate"}
      </button>
      {message ? (
        <p className={styles.rowMessage} role="status">
          {message}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title="Deactivate this person?"
        message="They won't be able to sign in. Their commitments and history stay intact and reappear if you reactivate them later."
        confirmLabel="Deactivate"
        tone="danger"
        onConfirm={() => apply("inactive")}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
    </div>
  );
}
