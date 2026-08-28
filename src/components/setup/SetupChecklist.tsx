import Link from "next/link";
import type { SetupStep } from "@/lib/dashboard/setup-steps";
import styles from "./SetupChecklist.module.css";

// First-run "Set up {Company}" scaffold. Rendered as the top card
// of /scorecard (the AiMS Implementation surface) whenever the
// caller can manage this company AND at least one step is still
// incomplete. Every step is non-blocking — order suggests a
// sequence but nothing enforces it, and each ticks off
// automatically as its conditions become true (nothing about
// completion is persisted; every value is derived per render).

export function SetupChecklist({
  steps,
  companyName,
}: {
  steps: SetupStep[];
  companyName: string;
}) {
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;

  return (
    <section className={styles.card} aria-labelledby="setup-checklist">
      <div className={styles.header}>
        <div>
          <h2 id="setup-checklist" className={styles.h2}>
            Set up {companyName}
          </h2>
          <p className={styles.meta}>
            A short sequence to get the platform working. Steps check off
            automatically as you finish them.
          </p>
        </div>
        <div className={styles.progressBadge} aria-hidden="true">
          {doneCount} of {total}
        </div>
      </div>
      <ol className={styles.list}>
        {steps.map((step, i) => (
          <li
            key={step.key}
            className={styles.item}
            data-done={step.done ? "true" : undefined}
          >
            <div className={styles.badge} aria-hidden="true">
              {step.done ? (
                <svg viewBox="0 0 16 16" width={14} height={14}>
                  <path
                    d="M3.5 8.5 L6.5 11.5 L12.5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <span>{i + 1}</span>
              )}
            </div>
            <div className={styles.body}>
              <div className={styles.itemTitle}>{step.label}</div>
              <div className={styles.itemDescription}>{step.description}</div>
            </div>
            {step.done ? (
              <span className={styles.doneLabel}>Done</span>
            ) : (
              <Link href={step.href} className={styles.stepLink}>
                Open →
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
