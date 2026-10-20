"use client";

import { useState, useTransition } from "react";
import { saveMeetingHeadlineAction } from "@/lib/meeting/actions";
import { HEADLINE_MAX_CHARS } from "@/lib/meeting/headlines";
import styles from "./meeting.module.css";

// This week's headline for one functional area, written in the room.
// Saves when the field loses focus and something changed (the same
// way the autosave switch treats the measures grid), so there is no
// Save button to find on a shared screen.
export function HeadlineField({
  functionId,
  functionTitle,
  weekEnding,
  initial,
}: {
  functionId: string;
  functionTitle: string;
  weekEnding: string;
  initial: string;
}) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    const next = value.trim();
    if (next === saved.trim()) return;
    setState(null);
    startTransition(async () => {
      const result = await saveMeetingHeadlineAction(functionId, weekEnding, next);
      if (result.ok) {
        setSaved(next);
        setState({ ok: true, text: "Saved" });
      } else {
        setState({ ok: false, text: result.message });
      }
    });
  }

  const id = `headline-${functionId}`;
  return (
    <div className={styles.headlineEdit}>
      <label htmlFor={id} className={styles.srOnly}>
        This week, {functionTitle}
      </label>
      <textarea
        id={id}
        className={styles.headlineInput}
        value={value}
        maxLength={HEADLINE_MAX_CHARS}
        rows={3}
        placeholder="What happened, what worked, what's coming, what you need."
        onChange={(e) => {
          setState(null);
          setValue(e.target.value);
        }}
        onBlur={save}
      />
      <p className={styles.headlineStatus} role={state?.ok === false ? "alert" : "status"} aria-live="polite">
        {pending ? "Saving" : state?.text ?? ""}
      </p>
    </div>
  );
}
