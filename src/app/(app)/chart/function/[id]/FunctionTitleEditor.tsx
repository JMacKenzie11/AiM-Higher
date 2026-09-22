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
//
// The chart drawer renders it in the drawer's gradient head, which
// is why the read state inherits its font and colour rather than
// setting either: one component, two headings, no second style.
// `onRenamed` is how the drawer's own copy of the title follows the
// edit — router.refresh() reaches the RSC tree behind the panel,
// never the client state inside it.

export function FunctionTitleEditor({
  functionId,
  initialTitle,
  canEdit,
  onRenamed,
}: {
  functionId: string;
  initialTitle: string;
  canEdit: boolean;
  onRenamed?: (title: string) => void;
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
        onRenamed?.(next);
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
