"use client";

import { useActionState } from "react";
import { archiveWorkerAction, updateWorkerAction, type WorkerFormState } from "@/lib/workers/actions";
import { NAME_MAX } from "@/lib/workers/types";
import styles from "../workers.module.css";

export function WorkerSettingsForm({ workerId, name, instructions }: { workerId: string; name: string; instructions: string }) {
  const [state, formAction, pending] = useActionState<WorkerFormState, FormData>(updateWorkerAction.bind(null, workerId), null);
  return (
    <form action={formAction} className={styles.body}>
      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input name="name" className={styles.input} defaultValue={name} maxLength={NAME_MAX} required autoComplete="off" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Instructions</span>
        <span className={styles.hint}>The job, a checklist of what must be true when it&apos;s done, the rules it can&apos;t find out by itself, and the reply you want. The worker reads them on every task.</span>
        <textarea name="instructions" className={`${styles.textarea} ${styles.instructions}`} defaultValue={instructions} />
      </label>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="submit" formAction={archiveWorkerAction.bind(null, workerId)} formNoValidate className={styles.secondary}>
          Archive worker
        </button>
        {state && !state.ok ? <p className={styles.error} role="alert">{state.message}</p> : null}
        {state?.ok && state.message ? <p className={styles.saved} role="status">{state.message}</p> : null}
      </div>
    </form>
  );
}
