"use client";

import { useState, type ReactNode } from "react";
import { CardAccent } from "@/components/ui/CardAccent";
import styles from "./foundation.module.css";

// A card that swaps between read and edit modes in place. Used for
// the singleton foundation sections (Purpose, Vision, Marketing
// Strategy) so admins get an inline Edit affordance in the card
// footer instead of a separate dashed disclosure below.

export function SectionEditToggle({
  title,
  readView,
  editView,
  canEdit,
  accent = false,
}: {
  title: string;
  readView: ReactNode;
  editView: ReactNode;
  canEdit: boolean;
  accent?: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <section
      className={accent ? styles.cardAccent : styles.card}
      aria-label={title}
    >
      {accent ? <CardAccent /> : null}

      <h2 className={styles.h2}>{title}</h2>

      {editing ? (
        <div className={styles.editPanel}>
          {editView}
          <div className={styles.cardFooter}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setEditing(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <>
          {readView}
          {canEdit ? (
            <div className={styles.cardFooter}>
              <button
                type="button"
                className={styles.editButton}
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
