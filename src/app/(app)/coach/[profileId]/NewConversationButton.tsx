"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createConversationAction } from "@/lib/coach/actions";
import type { CoachingContextKind } from "@/lib/coach/service";
import styles from "../coach.module.css";

export function NewConversationButton({
  profileId,
  contextKind = "execution",
}: {
  profileId: string;
  contextKind?: CoachingContextKind;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function start() {
    startTransition(async () => {
      const result = await createConversationAction(profileId, contextKind);
      if (result.ok) {
        router.push(`/coach/${profileId}/${result.item.id}`);
      } else {
        alert(result.message);
      }
    });
  }

  const label = contextKind === "strengths" ? "Coach on my strengths" : "New conversation";

  return (
    <button
      type="button"
      className={styles.primaryButton}
      onClick={start}
      disabled={pending}
    >
      {pending ? "Starting…" : label}
    </button>
  );
}
