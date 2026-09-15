"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDirectedMemoryAction,
  type MemoryListRow,
} from "@/lib/coach/memory-actions";
import { MAX_DIRECTED_MEMORY_CHARS } from "@/lib/coach/memory-shape";
import { MemoryRows } from "./MemoryRows";
import styles from "./memory-card.module.css";

// The memory surface where a person already goes to see what the
// product holds about them: their own profile, beside their photo and
// their strengths. It used to be a sidebar entry of its own, which
// put "what Aimee remembers about me" in the navigation next to
// features, rather than next to the other things that ARE me.
//
// The card is a window, not the whole room. It shows the few most
// recent and links to the full list, which keeps every part 3
// requirement: newest first, dated, conversation-linked, kinds
// distinguished, delete on every row.
export function MemoryCard({ memories }: { memories: MemoryListRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A decline is not an error. It is Aimee answering, and it gets the
  // calmer treatment: the sentence, and what can be kept instead.
  const [declined, setDeclined] = useState<string | null>(null);

  function add() {
    const content = draft.trim();
    if (content.length === 0) return;
    setError(null);
    setDeclined(null);
    startTransition(async () => {
      const result = await addDirectedMemoryAction(content);
      if (result.ok) {
        setDraft("");
        router.refresh();
      } else if (result.declined) {
        setDeclined(result.message);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <>
      <div className={styles.addRow}>
        <input
          className={styles.input}
          value={draft}
          maxLength={MAX_DIRECTED_MEMORY_CHARS}
          placeholder="Something you want Aimee to remember"
          aria-label="Add a memory"
          onChange={(e) => {
            setDraft(e.target.value);
            setDeclined(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          disabled={pending}
        />
        <button
          type="button"
          className={styles.addButton}
          onClick={add}
          disabled={pending || draft.trim().length === 0}
        >
          {pending ? "Saving…" : "Add a memory"}
        </button>
      </div>

      {declined ? (
        <p className={styles.declined} role="status">
          {declined}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {memories.length === 0 ? (
        <p className={styles.empty}>
          Aimee hasn&rsquo;t noted anything yet. Notes appear once you&rsquo;ve
          finished a conversation and moved on to another one, and anything you
          add above lands here straight away.
        </p>
      ) : (
        <MemoryRows rows={memories} />
      )}

    </>
  );
}
