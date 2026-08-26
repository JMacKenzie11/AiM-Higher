"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createOutcomeAction,
  type ChartResult,
} from "@/lib/chart/actions";
import type { FunctionOutcome } from "@/lib/types";
import styles from "./measures.module.css";

const INITIAL: ChartResult<FunctionOutcome> = { ok: false, message: "" };

// Per-function "add an outcome" row. Type a title, Enter to save.
// Description gets filled in via the Details drawer after creation.
// When the parent passes onAdded, the form calls it after a
// successful save so the parent can collapse the row back to its
// "+ Add" button. Without onAdded the input refocuses for rapid
// entry (chart-page-era behaviour).
export function AddOutcomeInline({
  functionId,
  onAdded,
}: {
  functionId: string;
  onAdded?: () => void;
}) {
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
      if (onAdded) {
        onAdded();
      } else {
        inputRef.current?.focus();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className={styles.addOutcomeRow}>
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
        className={styles.addOutcomeInput}
        placeholder="Add an outcome, press Enter to save."
        required
        disabled={pending}
        aria-label="New outcome"
      />
      {pending ? <span className={styles.savingHint}>Saving…</span> : null}
      {errorMessage ? (
        <p role="alert" className={styles.rowError}>
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}
