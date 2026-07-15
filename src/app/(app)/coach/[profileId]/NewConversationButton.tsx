"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createConversationAction } from "@/lib/coach/actions";
import styles from "../coach.module.css";

export function NewConversationButton({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function start() {
    startTransition(async () => {
      const result = await createConversationAction(profileId);
      if (result.ok) {
        router.push(`/coach/${profileId}/${result.item.id}`);
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
