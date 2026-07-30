"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createOutcomeAction,
  type ChartResult,
} from "@/lib/chart/actions";
import type { FunctionOutcome } from "@/lib/types";
import styles from "../../chart.module.css";

// Always-live entry for Success Measures — same rhythm as R&R and
// the commitment row. Type a title, Enter to save, focus jumps back
// so the next one goes in without leaving the keyboard. Editing the
// description or adding metrics happens once the row is saved.

const INITIAL: ChartResult<FunctionOutcome> = { ok: false, message: "" };

export function AddSuccessMeasureRow({ functionId }: { functionId: string }) {
  const [state, formAction, pending] = useActionState<
    ChartResult<FunctionOutcome>,
    FormData
  >(createOutcomeAction, INITIAL);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      setTitle("");
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={formAction} className={`${styles.roleRow} ${styles.roleRowDraft}`}>
      <input type="hidden" name="function_id" value={functionId} />
      <input
        ref={inputRef}
        type="text"
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setTitle("");
          }
        }}
        className={styles.roleInput}
        placeholder="Add a success measure — press Enter to save."
        required
        disabled={pending}
        aria-label="New success measure"
      />
      <button
        type="submit"
        className={styles.rolePrimaryButton}
        disabled={pending || !title.trim()}
      >
        {pending ? "Adding…" : "Add"}
      </button>
      {errorMessage ? (
        <p role="alert" className={styles.roleError}>
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}
