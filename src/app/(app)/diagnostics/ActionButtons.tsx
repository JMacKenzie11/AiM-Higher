"use client";

import { useRouter } from "next/navigation";
import {
  setClientArchivedAction,
  setDiagnosticArchivedAction,
  startDiagnosticAction,
} from "@/lib/diagnostics/actions";
import { useDxAction } from "./useDxAction";
import styles from "./diagnostics.module.css";

// The one-press actions on the client and diagnostic pages.

export function StartDiagnosticButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const { pending, error, run } = useDxAction();
  return (
    <>
      <button
        type="button"
        className={`${styles.secondary} ${styles.small}`}
        disabled={pending}
        onClick={() => run(() => startDiagnosticAction(clientId), (r) => r.id && router.push(`/diagnostics/${r.id}?step=preflight`))}
      >
        Start a diagnostic
      </button>
      {error ? <span className={styles.error} role="alert">{error}</span> : null}
    </>
  );
}

export function ArchiveButton({ kind, id, archived }: { kind: "client" | "diagnostic"; id: string; archived: boolean }) {
  const { pending, error, run } = useDxAction();
  const act = kind === "client" ? setClientArchivedAction : setDiagnosticArchivedAction;
  return (
    <>
      <button type="button" className={`${styles.secondary} ${styles.small}`} disabled={pending} onClick={() => run(() => act(id, !archived))}>
        {archived ? "Restore" : "Archive"}
      </button>
      {error ? <span className={styles.error} role="alert">{error}</span> : null}
    </>
  );
}
