"use client";

import { useTransition } from "react";
import { moveFoundationItemAction } from "@/lib/foundation/actions";
import styles from "./foundation.module.css";

// Up/down reorder controls for foundation_items. v1 spec allows simple
// up/down buttons in place of drag-to-reorder.

export function MoveButtons({ itemId }: { itemId: string }) {
  const [pending, startTransition] = useTransition();

  function move(direction: "up" | "down") {
    startTransition(async () => {
      await moveFoundationItemAction(itemId, direction);
    });
  }

  return (
    <div className={styles.moveButtons}>
      <button
        type="button"
        className={styles.ghostButton}
        onClick={() => move("up")}
        disabled={pending}
        aria-label="Move up"
      >
        ↑
      </button>
      <button
        type="button"
        className={styles.ghostButton}
        onClick={() => move("down")}
        disabled={pending}
        aria-label="Move down"
      >
        ↓
      </button>
    </div>
  );
}
