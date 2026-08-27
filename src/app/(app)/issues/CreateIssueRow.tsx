"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createIssueAction,
  type IssueResult,
} from "@/lib/issues/actions";
import uiStyles from "@/components/ui/ui.module.css";
import commitmentStyles from "../commitments/commitments.module.css";
import styles from "./issues.module.css";

// Bottom-of-list "add an issue" row. Composes the same
// .inlineAddRow + .addForm treatment as the /commitments
// InlineAddRow so the two surfaces read as siblings — dashed top
// border, subtle navy tint fill, bordered text field, primary
// pill "Add" button on the right. Issues only have a title at
// creation; desired_outcome and commitments get filled in via
// the row's inline editors after save.

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
    <div
      className={`${commitmentStyles.inlineAddRow} ${commitmentStyles.inlineAddRowDraft}`}
    >
      <form action={formAction} className={styles.addForm}>
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
          className={commitmentStyles.addField}
          placeholder="Add an issue — a problem, tension, or unresolved question."
          required
          disabled={pending}
          aria-label="New issue"
        />
        <button
          type="submit"
          className={`${uiStyles.btnGhost} ${uiStyles.btnSm}`}
          disabled={pending || !title.trim()}
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
      {errorMessage ? (
        <p role="alert" className={styles.rowError}>
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
