"use client";

import { useId, useState } from "react";
import { addParticipantsAction } from "@/lib/diagnostics/actions";
import { useDxAction } from "../useDxAction";
import admin from "../../admin/companies/admin.module.css";
import styles from "../diagnostics.module.css";

// The people in scope, typed or pasted as a list.
export function AddPeople({ diagnosticId }: { diagnosticId: string }) {
  const id = useId();
  const [text, setText] = useState("");
  const { pending, error, run } = useDxAction();
  return (
    <div className={admin.field}>
      <label className={admin.label} htmlFor={id}>
        Add people
      </label>
      <textarea
        id={id}
        className={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"One person per line: name, role, email\nDana Ruiz, Estimator, dana@example.com"}
      />
      <span className={styles.formRow}>
        <button
          type="button"
          className={`${styles.secondary} ${styles.small}`}
          disabled={pending || !text.trim()}
          onClick={() => run(() => addParticipantsAction(diagnosticId, text), () => setText(""))}
        >
          Add these people
        </button>
        {error ? <span className={styles.error} role="alert">{error}</span> : null}
      </span>
    </div>
  );
}
