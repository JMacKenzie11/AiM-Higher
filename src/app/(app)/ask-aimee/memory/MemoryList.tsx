"use client";

import { MemoryRows } from "../../profile/MemoryRows";
import type { MemoryListRow } from "@/lib/coach/memory-actions";
import styles from "./memory.module.css";

// The full list. Renders the SAME table as the profile card, via the
// same component, because they show the same object and had already
// drifted apart once: the card gained a kind before the list did, and
// the two labels were written twice.
//
// What stays here is the framing the card cannot carry: the failed-
// read state, and the empty state that explains when notes appear.
export function MemoryList({
  memories,
  readFailed = false,
}: {
  memories: MemoryListRow[];
  readFailed?: boolean;
}) {
  // A failed read is not an empty memory, and must never be reported
  // as one. Saying "Aimee hasn't noted anything yet" when the query
  // was refused tells the person their memory is empty on the
  // strength of a question we could not ask.
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
          finished a conversation and moved on to another one, and anything you
          add on your profile lands here straight away.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <MemoryRows rows={memories} />
    </div>
  );
}
