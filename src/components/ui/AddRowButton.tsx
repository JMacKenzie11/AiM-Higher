"use client";

import styles from "./ui.module.css";

// The Add button for a draft row, in one place.
//
// Five surfaces used to commit a draft row on Enter alone, with no
// visible control: critical success factors, KPIs, responsibilities,
// decision rights and competencies. That was consistent with itself
// and invisible to anybody who had not been told, and "press Enter to
// save" in a placeholder is instruction text doing a button's job.
//
// One component rather than five buttons, because the point is a
// single standard. A future change to how a draft row commits has one
// place to happen, and the five cannot drift apart again.
//
// The house primary at small size, matching every other committing
// action in the app.
//
// `type` and `onClick` exist for the one caller whose draft row is
// not a form: /chart's Add function panel builds its
// responsibilities in client state and submits them with the
// function, so its Add commits a row to a list rather than posting.
// Submit is still the default, because five of the six callers are
// forms and the sixth should be the one that has to say so.
export function AddRowButton({
  pending = false,
  label = "Add",
  disabled = false,
  type = "submit",
  onClick,
}: {
  pending?: boolean;
  label?: string;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm} ${styles.addRowButton}`}
      disabled={pending || disabled}
    >
      {pending ? "Adding…" : label}
    </button>
  );
}
