"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createOutcomeAction,
  type ChartResult,
} from "@/lib/chart/actions";
import type { FunctionOutcome } from "@/lib/types";
import styles from "./measures.module.css";

const INITIAL: ChartResult<FunctionOutcome> = { ok: false, message: "" };

// Per-function "add an outcome" row. Same rhythm as the chart page
// version: type a title, Enter to save, focus returns for the next.
// Description gets filled in via the Details drawer after creation.
export function AddOutcomeInline({ functionId }: { functionId: string }) {
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
