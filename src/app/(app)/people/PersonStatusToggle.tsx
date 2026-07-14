"use client";

import { useState, useTransition } from "react";
import { setProfileStatusAction } from "@/lib/people/actions";
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

  function toggle() {
    if (disabled) return;
    const next = currentStatus === "active" ? "inactive" : "active";
    if (
      next === "inactive" &&
      !confirm("Deactivate this person? They won't be able to sign in.")
    ) {
      return;
    }
    startTransition(async () => {
      const result = await setProfileStatusAction(personId, next);
      if (!result.ok) setMessage(result.message);
    });
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
        onClick={toggle}
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
    </div>
  );
}
