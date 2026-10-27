"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { answerQuestionAction, decideApprovalAction, type WorkerFormState } from "@/lib/workers/actions";
import type { Pending } from "@/lib/workers/types";
import styles from "./workers.module.css";

// A task waiting on its owner (0303, step 2): a question with an answer
// box, or a press with Allow once, Allow always and Deny. On the home
// page under Needs you, and on the task's own page.
export function NeedsYouCard({
  runId,
  workerId,
  workerName,
  initialsText,
  pending,
  ago,
  expiresIn,
  showOpen = true,
}: {
  runId: string;
  workerId: string;
  workerName: string;
  initialsText: string;
  pending: Pending;
  ago: string;
  expiresIn: string;
  showOpen?: boolean;
}) {
  const [state, formAction, sending] = useActionState<WorkerFormState, FormData>(answerQuestionAction.bind(null, runId), null);
  const [decided, setDecided] = useState<WorkerFormState>(null);
  const [deciding, startDeciding] = useTransition();
  const decide = (d: "once" | "always" | "deny") => startDeciding(async () => setDecided(await decideApprovalAction(runId, d)));
  const message = (state && !state.ok ? state.message : null) ?? (decided && !decided.ok ? decided.message : null);

  return (
    <article className={styles.needsCard} data-testid="needs-you-card">
      <header className={styles.needsHead}>
        <span className={styles.avatar} aria-hidden="true">{initialsText}</span>
        <div className={styles.rowMain}>
          <p className={styles.feedHead}><strong>{workerName}</strong></p>
          <p className={styles.rowMeta}>
            {pending.kind === "question" ? "Question" : "Approval"} · {ago} · Expires in {expiresIn}
          </p>
        </div>
        {showOpen ? (
          <Link href={`/workers/${workerId}/runs/${runId}`} className={styles.link}>
            Open task
          </Link>
        ) : null}
      </header>

      {pending.kind === "question" ? (
        <form action={formAction} className={styles.needsBody}>
          <p className={styles.needsText}>{pending.text}</p>
          {pending.password_for ? (
            <p className={styles.hint}>
              This is a password for {pending.password_for}. It&apos;s saved for this worker to type, and nobody can read it back, you included.
            </p>
          ) : null}
          <div className={styles.answerRow}>
            <input
              name="answer"
              type={pending.password_for ? "password" : "text"}
              autoComplete={pending.password_for ? "new-password" : "off"}
              className={styles.input}
              placeholder={pending.password_for ? "The password" : "Your answer"}
              aria-label={pending.password_for ? "The password" : "Your answer"}
              required
            />
            <button type="submit" className={styles.primary} disabled={sending}>
              {sending ? "Sending…" : "Send answer"}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.needsBody}>
          <p className={styles.needsText}>
            It wants to {pending.action.replace(/^Press/, "press")} on {pending.domain || "this page"}.
          </p>
          {pending.always_asks ? <p className={styles.hint}>This kind of action always asks you first.</p> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={deciding} onClick={() => decide("once")}>
              Allow once
            </button>
            {!pending.always_asks && pending.domain ? (
              <button type="button" className={styles.secondary} disabled={deciding} onClick={() => decide("always")}>
                Allow always on {pending.domain}
              </button>
            ) : null}
            <button type="button" className={styles.secondary} disabled={deciding} onClick={() => decide("deny")}>
              Deny
            </button>
          </div>
        </div>
      )}
      {message ? <p className={styles.error} role="alert">{message}</p> : null}
    </article>
  );
}
