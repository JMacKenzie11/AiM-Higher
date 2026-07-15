"use client";

import { useTransition } from "react";
import { archiveConversationAction } from "@/lib/coach/actions";
import styles from "../coach.module.css";

export function ArchiveConversationButton({
  conversationId,
}: {
  conversationId: string;
}) {
  const [pending, startTransition] = useTransition();

  function run() {
    if (!confirm("Archive this conversation? It'll disappear from the list.")) return;
    startTransition(async () => {
      const result = await archiveConversationAction(conversationId);
      if (!result.ok) alert(result.message);
    });
  }

  return (
    <button
      type="button"
      className={styles.ghostButton}
      onClick={run}
      disabled={pending}
    >
      {pending ? "…" : "Archive"}
    </button>
  );
}
