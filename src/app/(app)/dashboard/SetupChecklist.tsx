import Link from "next/link";
import { CardAccent } from "@/components/ui/CardAccent";
import styles from "./dashboard.module.css";

// First-run setup checklist. Renders when the caller is admin AND
// the company still has at least one setup step incomplete, so it
// only shows for the audience it teaches and only until the platform
// is genuinely in use. Steps are computed by the caller and passed
// in as booleans so page.tsx keeps the data assembly.
//
// Order (people-first, plan last): build the team + chart, invite
// the team, start the rhythm, then build the vision + strategic
// plan. The vision step lands last because the exercises behind
// it usually happen away from the app; the earlier steps give
// people something concrete to log against in the meantime.
// Every step is non-blocking — a user can complete them in any
// order, and each checks off automatically as its conditions
// become true. Note: opening a quarter isn't in the checklist
// because company creation auto-seeds the current calendar quarter
// as open.

export type SetupStep = {
  key: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
};

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
    <section className={styles.cardAccent} aria-labelledby="setup-checklist">
      <CardAccent />
      <div className={styles.setupHeader}>
        <div>
          <h2 id="setup-checklist" className={styles.h2}>
            Set up {companyName}
          </h2>
          <p className={styles.cardMeta}>
            A short sequence to get the platform working. Steps check off
            automatically as you finish them.
          </p>
        </div>
        <div className={styles.setupProgressBadge} aria-hidden="true">
          {doneCount} of {total}
        </div>
      </div>
      <ol className={styles.setupList}>
        {steps.map((step, i) => (
          <li
            key={step.key}
            className={styles.setupItem}
            data-done={step.done ? "true" : undefined}
          >
            <div className={styles.setupBadge} aria-hidden="true">
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
            <div className={styles.setupBody}>
              <div className={styles.setupItemTitle}>{step.label}</div>
              <div className={styles.setupItemDescription}>
                {step.description}
              </div>
            </div>
            {step.done ? (
              <span className={styles.setupDoneLabel}>Done</span>
            ) : (
              <Link href={step.href} className={styles.setupStepLink}>
                Open →
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
