"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createGeneralConversationAction } from "@/lib/coach/actions";
import styles from "../coach/coach.module.css";

export function AskAimeeNewButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function start() {
    setError(null);
    startTransition(async () => {
      const result = await createGeneralConversationAction();
      if (result.ok) {
        router.push(`/ask-aimee/${result.item.id}`);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        type="button"
        className={styles.primaryButton}
        onClick={start}
        disabled={pending}
      >
        {pending ? "Starting…" : "New conversation"}
      </button>
      {error ? (
        <span role="alert" style={{ color: "var(--aims-danger)", fontSize: 13 }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
