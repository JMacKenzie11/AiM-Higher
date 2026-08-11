"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPracticeConversationAction } from "@/lib/practices/actions";
import {
  PRACTICE_CATEGORIES,
  type PracticeCategory,
} from "@/lib/practices/categories";
import type { Practice } from "@/lib/practices/registry";
import styles from "./practice.module.css";

// Entry cards for the Ask Aimee landing page. One card per registry
// entry, grouped under a category subheading. On click, creates a
// new practice conversation and routes the user into it. Rendering
// is driven by the registry so adding a practice or category is
// zero-code (registry entry + prompt file only).

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

  // Group practices by category, preserving PRACTICE_CATEGORIES order.
  // Practices inside each category keep their PRACTICES-array order,
  // so the registry is the single place that controls sort.
  const grouped = useMemo(() => {
    const byCategory = new Map<PracticeCategory, Practice[]>();
    for (const cat of PRACTICE_CATEGORIES) byCategory.set(cat, []);
    for (const p of practices) byCategory.get(p.category)?.push(p);
    return PRACTICE_CATEGORIES
      .map((cat) => ({ category: cat, items: byCategory.get(cat) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [practices]);

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
        Practices
      </h2>
      {grouped.map(({ category, items }) => (
        <div key={category} className={styles.categoryGroup}>
          <h3 className={styles.categoryHeader}>{category}</h3>
          <ul className={styles.rowList}>
            {items.map((practice) => (
              <li key={practice.id}>
                <button
                  type="button"
                  className={styles.row}
                  onClick={() => open(practice)}
                  disabled={pending}
                  aria-busy={pendingId === practice.id}
                >
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{practice.title}</span>
                    <span className={styles.rowDescription}>
                      {practice.description}
                    </span>
                    {errorFor?.id === practice.id ? (
                      <span className={styles.rowError} role="alert">
                        {errorFor.message}
                      </span>
                    ) : null}
                  </span>
                  <svg
                    className={styles.rowChevron}
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
