"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createIssueAction,
  type IssueResult,
} from "@/lib/issues/actions";
import styles from "./issues.module.css";

const INITIAL: IssueResult = { ok: false, message: "" };

export function CreateIssueRow() {
  const [state, formAction, pending] = useActionState<
    IssueResult,
    FormData
  >(createIssueAction, INITIAL);
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
    <form action={formAction} className={styles.createRow}>
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
        className={styles.createInput}
        placeholder="Name a new issue, press Enter to add it to the list."
        required
        disabled={pending}
        aria-label="New issue"
      />
      {pending ? (
        <span className={styles.savingHint}>Saving…</span>
      ) : null}
      {errorMessage ? (
        <p role="alert" className={styles.rowError}>
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}
