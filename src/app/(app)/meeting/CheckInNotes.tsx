"use client";

import { useState, useTransition } from "react";
import { NotesEditor, type NotesDoc } from "@/components/tiptap/NotesEditor";
import { saveMeetingCheckinAction } from "@/lib/meeting/actions";
import styles from "./meeting.module.css";

// This week's check-in notes, written in the room as people answer.
// Saves when the writer leaves the notes and something changed, as a
// headline does, so there is no Save button to find on a shared
// screen.
export function CheckInNotes({ weekEnding, initial, canWrite }: { weekEnding: string; initial: NotesDoc | null; canWrite: boolean }) {
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);

  function save(doc: NotesDoc) {
    const next = JSON.stringify(doc);
    if (next === saved) return;
    setState(null);
    startTransition(async () => {
      const result = await saveMeetingCheckinAction(weekEnding, doc);
      if (result.ok) {
        setSaved(next);
        setState({ ok: true, text: "Saved" });
      } else {
        setState({ ok: false, text: result.message });
      }
    });
  }

  return (
    <div className={styles.checkinNotes}>
      <NotesEditor initial={initial} onBlur={save} editable={canWrite} label="Check-in notes" />
      <p className={styles.headlineStatus} role={state?.ok === false ? "alert" : "status"} aria-live="polite">
        {pending ? "Saving" : state?.text ?? ""}
      </p>
    </div>
  );
}
