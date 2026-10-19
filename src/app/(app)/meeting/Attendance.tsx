"use client";

import { useState, useTransition } from "react";
import { setMeetingAttendanceAction } from "@/lib/meeting/actions";
import styles from "./meeting.module.css";

// Who is in the room: a tick beside each name, the first thing on the
// check-in (Jason, 2026-10-19). Clicking it marks the person present
// at once and fills the tick; clicking again takes it off. Saved as it
// goes (meeting_attendance, 0290), so there is nothing to submit.
export function Attendance({
  people,
  initialPresent,
  canMark,
}: {
  people: Array<{ id: string; full_name: string }>;
  initialPresent: string[];
  canMark: boolean;
}) {
  const [present, setPresent] = useState(() => new Set(initialPresent));
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    const next = !present.has(id);
    setPresent((s) => {
      const copy = new Set(s);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
    setError(null);
    startTransition(async () => {
      const result = await setMeetingAttendanceAction(id, next);
      if (!result.ok) {
        setError(result.message);
        setPresent((s) => {
          const copy = new Set(s);
          if (next) copy.delete(id);
          else copy.add(id);
          return copy;
        });
      }
    });
  }

  return (
    <>
      <ul className={styles.attendance} aria-label="Who's here">
        {people.map((p) => {
          const on = present.has(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                className={styles.attendee}
                aria-pressed={on}
                data-present={on ? "true" : undefined}
                onClick={() => toggle(p.id)}
                disabled={!canMark}
                title={on ? `${p.full_name} is here. Click to take the mark off.` : `Mark ${p.full_name} as here`}
              >
                <span className={styles.attendeeTick} aria-hidden>
                  {on ? (
                    <svg viewBox="0 0 16 16" width="12" height="12">
                      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </span>
                <span>{p.full_name}</span>
                <span className={styles.srOnly}>{on ? ", present" : ", not marked"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.attendanceCount} role={error ? "alert" : "status"} aria-live="polite">
        {error ?? `${present.size} of ${people.length} here`}
      </p>
    </>
  );
}
