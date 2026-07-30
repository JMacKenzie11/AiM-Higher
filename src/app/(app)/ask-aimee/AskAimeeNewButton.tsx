"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createGeneralConversationAction } from "@/lib/coach/actions";
import styles from "../coach/coach.module.css";

export function AskAimeeNewButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function start() {
    startTransition(async () => {
      const result = await createGeneralConversationAction();
      if (result.ok) {
        router.push(`/ask-aimee/${result.item.id}`);
      } else {
        alert(result.message);
      }
    });
  }

  return (
    <button
      type="button"
      className={styles.primaryButton}
      onClick={start}
      disabled={pending}
    >
      {pending ? "Starting…" : "New conversation"}
    </button>
  );
}
