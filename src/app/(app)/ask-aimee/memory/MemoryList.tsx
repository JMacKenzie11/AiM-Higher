"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { deleteMyMemoryAction, type MemoryListRow } from "@/lib/coach/memory-actions";
import { formatShortDate } from "@/lib/dates";
import styles from "./memory.module.css";

// The list, and the delete on every row.
//
// Delete follows the app's standard destructive affordance: a ghost
// button in the row's trailing slot, one ConfirmDialog with
// tone="danger", and the work done on confirm. No undo chip, no
// "deleted · restore" strip — the commitment surfaces have those
// because resolving a commitment is a judgement somebody might want
// back, and forgetting is not. Undo theatre on this page would also
// be a small lie: the row is gone from the database the moment it is
// gone from the screen.
export function MemoryList({
  memories,
  readFailed = false,
}: {
  memories: MemoryListRow[];
  readFailed?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<MemoryListRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  function remove(memory: MemoryListRow) {
    setConfirming(null);
    setError(null);
    startTransition(async () => {
      const result = await deleteMyMemoryAction(memory.id);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  }

  // A failed read is not an empty memory, and must never be reported
  // as one. Saying "Aimee hasn't noted anything yet" when the query was
  // refused tells the person their memory is empty on the strength of a
  // question we could not ask.
  if (readFailed) {
    return (
      <div className={styles.card}>
        <p className={styles.empty}>
          We couldn&rsquo;t load your memory just now. Nothing has been lost.
          Try again in a moment.
        </p>
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <div className={styles.card}>
        <p className={styles.empty}>
          Aimee hasn&rsquo;t noted anything yet. Notes appear once you&rsquo;ve
          finished a conversation and moved on to another one, so the thread
          you&rsquo;re in is never the one being written down. Coaching about
          someone else doesn&rsquo;t add anything here: only your own
          conversations do.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className={styles.card}>
        {memories.map((memory) => (
          <div key={memory.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.content}>{memory.content}</span>
              <span className={styles.meta}>
                <span>{formatShortDate(memory.created_at.slice(0, 10))}</span>
                {/* The kind, as a label. 'said' is what you told her;
                    'inferred' is what she concluded. Both are shown —
                    hiding the inferences would make the page a
                    partial account of what she is working from. */}
                <span className={styles.kindTag}>
                  {memory.kind === "said" ? "You said" : "Aimee inferred"}
                </span>
                {memory.conversation_ref ? (
                  <Link
                    href={`/ask-aimee/${memory.conversation_ref}`}
                    className={styles.sourceLink}
                  >
                    {memory.conversation_title ?? "the conversation"}
                  </Link>
                ) : null}
              </span>
            </div>
            <button
              type="button"
              className={styles.deleteButton}
              onClick={() => setConfirming(memory)}
              disabled={pending}
              aria-label={`Delete: ${memory.content}`}
            >
              {pending ? "…" : "Delete"}
            </button>
          </div>
        ))}
      </div>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming !== null}
        title="Delete this memory?"
        message={
          confirming
            ? `Aimee will forget: "${confirming.content}" This can't be undone, and she won't use it in future conversations.`
            : ""
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => confirming && remove(confirming)}
        onCancel={() => setConfirming(null)}
        pending={pending}
      />
    </>
  );
}
