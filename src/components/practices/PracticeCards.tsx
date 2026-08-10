"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPracticeConversationAction } from "@/lib/practices/actions";
import type { Practice } from "@/lib/practices/registry";
import styles from "./practice.module.css";

// Entry cards for the Ask Aimee landing page. One card per registry
// entry; whole card is clickable. On click, creates a new practice
// conversation and routes the user into it. Rendering is driven by
// the registry so adding a second practice is zero-code (registry
// entry + prompt file only).

export function PracticeCards({
  practices,
}: {
  practices: readonly Practice[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorFor, setErrorFor] = useState<{
    id: string;
    message: string;
  } | null>(null);

  function open(practice: Practice) {
    if (pending) return;
    setPendingId(practice.id);
    setErrorFor(null);
    startTransition(async () => {
      const result = await createPracticeConversationAction(practice.id);
      if (!result.ok) {
        setErrorFor({ id: practice.id, message: result.message });
        setPendingId(null);
        return;
      }
      router.push(`/ask-aimee/${result.item.id}`);
    });
  }

  if (practices.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="practices-heading">
      <h2 id="practices-heading" className={styles.sectionHeader}>
        Work through a real situation
      </h2>
      <div className={styles.grid}>
        {practices.map((practice) => (
          <button
            key={practice.id}
            type="button"
            className={styles.card}
            onClick={() => open(practice)}
            disabled={pending}
            aria-busy={pendingId === practice.id}
          >
            <h3 className={styles.cardTitle}>{practice.title}</h3>
            <p className={styles.cardDescription}>{practice.description}</p>
            {errorFor?.id === practice.id ? (
              <p className={styles.cardError} role="alert">
                {errorFor.message}
              </p>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}
