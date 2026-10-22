"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { visitStepAction } from "@/lib/diagnostics/actions";
import type { DiagnosticStep } from "@/lib/diagnostics/steps";
import { useDxAction } from "../useDxAction";
import styles from "../diagnostics.module.css";

// Back and Next at the foot of every step's card. Next moves the
// diagnostic's status forward with it (visitStepAction), so the list
// shows where each engagement has got to.
export function StepFooter({
  diagnosticId,
  prev,
  next,
  blocked,
}: {
  diagnosticId: string;
  prev: { key: DiagnosticStep; label: string } | null;
  next: { key: DiagnosticStep; label: string } | null;
  blocked: string | null;
}) {
  const router = useRouter();
  const { pending, error, run } = useDxAction();
  return (
    <>
      {prev ? (
        <Link href={`/diagnostics/${diagnosticId}?step=${prev.key}`} className={styles.secondary}>
          Back
        </Link>
      ) : (
        <span />
      )}
      <span className={styles.formRow}>
        {blocked || error ? <span className={blocked ? styles.status : styles.error}>{error ?? blocked}</span> : null}
        {next ? (
          <button
            type="button"
            className={styles.secondary}
            disabled={pending || Boolean(blocked)}
            onClick={() =>
              run(
                () => visitStepAction(diagnosticId, next.key),
                () => router.push(`/diagnostics/${diagnosticId}?step=${next.key}`)
              )
            }
          >
            Next: {next.label}
          </button>
        ) : (
          <Link href="/diagnostics" className={styles.secondary}>
            Back to diagnostics
          </Link>
        )}
      </span>
    </>
  );
}
