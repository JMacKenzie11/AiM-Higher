"use client";

import { useActionState } from "react";
import { createWorkerAction, type WorkerFormState } from "@/lib/workers/actions";
import { INSTRUCTIONS_TEMPLATE, NAME_MAX } from "@/lib/workers/types";
import styles from "./workers.module.css";

export function NewWorkerForm() {
  const [state, formAction, pending] = useActionState<WorkerFormState, FormData>(createWorkerAction, null);
  return (
    <form action={formAction} className={styles.body}>
      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input name="name" className={styles.input} maxLength={NAME_MAX} required autoComplete="off" placeholder="For example: Shoe price checker" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Instructions</span>
        <span className={styles.hint}>The job, a checklist of what must be true when it&apos;s done, the rules it can&apos;t find out by itself, and the reply you want. The worker reads them on every task.</span>
        <textarea name="instructions" className={`${styles.textarea} ${styles.instructions}`} defaultValue={INSTRUCTIONS_TEMPLATE} />
      </label>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? "Creating…" : "Create worker"}
        </button>
        {state && !state.ok ? <p className={styles.error} role="alert">{state.message}</p> : null}
      </div>
    </form>
  );
}
