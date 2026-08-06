"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameFunctionAction } from "@/lib/chart/actions";
import styles from "../../chart.module.css";

// Click-to-edit affordance for the function's title on its detail
// page. Rendered in the hero via PageShell's title slot. Read view
// shows the H1 plus (for admins) a small "Rename" hint on hover;
// clicking swaps in a text input that saves on blur or Enter and
// reverts on Escape. Applies to every function — including the
// seed Visionary and Integrator boxes — so a company can localise
// or evolve the language.

export function FunctionTitleEditor({
  functionId,
  initialTitle,
  canEdit,
}: {
  functionId: string;
  initialTitle: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialTitle);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(initialTitle);
  }, [initialTitle]);

  function commit() {
    if (pending) return;
    const next = draft.trim();
    if (!next) {
      cancel();
      return;
    }
    if (next === initialTitle) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameFunctionAction(functionId, next);
      if (!result.ok) {
        setError(result.message);
      } else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  function cancel() {
    setDraft(initialTitle);
    setEditing(false);
    setError(null);
  }

  if (!canEdit) {
    return <>{initialTitle}</>;
  }

  if (editing) {
    return (
      <span className={styles.functionTitleEditingSlot}>
        <input
          ref={inputRef}
          className={styles.functionTitleInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          disabled={pending}
          autoFocus
          aria-label="Function name"
        />
        {error ? (
          <span role="alert" className={styles.functionTitleError}>
            {error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={styles.functionTitleEditable}
      onClick={() => setEditing(true)}
      title="Click to rename"
    >
      {initialTitle}
    </button>
  );
}
