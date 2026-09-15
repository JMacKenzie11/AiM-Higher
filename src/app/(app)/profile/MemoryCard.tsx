"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  addDirectedMemoryAction,
  deleteMyMemoryAction,
  type MemoryListRow,
} from "@/lib/coach/memory-actions";
import { MAX_DIRECTED_MEMORY_CHARS } from "@/lib/coach/memory-shape";
import { memoryKindLabel, memoryKindClass } from "@/lib/coach/memory-kind";
import { formatShortDate } from "@/lib/dates";
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
export function MemoryCard({
  recent,
  total,
}: {
  recent: MemoryListRow[];
  total: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<MemoryListRow | null>(null);
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

  function remove(memory: MemoryListRow) {
    setConfirming(null);
    setError(null);
    startTransition(async () => {
      const result = await deleteMyMemoryAction(memory.id);
      if (!result.ok) setError(result.message);
      else router.refresh();
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

      {recent.length === 0 ? (
        <p className={styles.empty}>
          Aimee hasn&rsquo;t noted anything yet. Notes appear once you&rsquo;ve
          finished a conversation and moved on to another one, and anything you
          add above lands here straight away.
        </p>
      ) : (
        <div className={styles.rows}>
          {recent.map((memory) => (
            <div
              key={memory.id}
              className={styles.row}
              data-testid="memory-row"
              data-kind={memory.kind}
            >
              <div className={styles.rowMain}>
                <span className={styles.content}>{memory.content}</span>
                <span className={styles.meta}>
                  <span>{formatShortDate(memory.created_at.slice(0, 10))}</span>
                  <span className={styles[memoryKindClass(memory.kind)]}>
                    {memoryKindLabel(memory.kind)}
                  </span>
                </span>
              </div>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setConfirming(memory)}
                disabled={pending}
                aria-label={`Delete: ${memory.content}`}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {total > recent.length ? (
        <Link className={styles.seeAll} href="/ask-aimee/memory">
          See all {total}
        </Link>
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        tone="danger"
        title="Delete this memory?"
        message={confirming?.content ?? ""}
        confirmLabel="Delete"
        onConfirm={() => confirming && remove(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
