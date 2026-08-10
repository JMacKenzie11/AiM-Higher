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
  headingId,
}: {
  title: string;
  readView: ReactNode;
  editView: ReactNode;
  canEdit: boolean;
  accent?: boolean;
  // Set to make the h2 an anchor target (used by the in-page nav on
  // the One-Page Plan).
  headingId?: string;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <section
      className={accent ? styles.cardAccent : styles.card}
      aria-label={title}
    >
      {accent ? <CardAccent /> : null}

      <h2 id={headingId} className={styles.h2}>
        {title}
      </h2>

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
