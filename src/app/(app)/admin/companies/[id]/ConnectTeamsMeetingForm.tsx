"use client";

import { useId, useState, useTransition } from "react";
import {
  connectTeamsMeetingAction,
  listTeamsMeetingsAction,
  type TeamsMeetingOption,
} from "@/lib/transcripts/actions";
import styles from "../admin.module.css";

// Pick a Teams meeting to bring transcripts in from (0325). The list
// is the connected Microsoft account's calendar, two weeks back to
// four weeks ahead, one row per meeting: a weekly meeting shows once.
// Fetched on request, not on page load, because it is a round trip to
// Microsoft that most visits to this page do not need.

function when(iso: string, recurring: boolean): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "long" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (recurring) return `Repeats · ${day}s at ${time}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ` at ${time}`;
}

export function ConnectTeamsMeetingForm({ companyId }: { companyId: string }) {
  const [meetings, setMeetings] = useState<TeamsMeetingOption[] | null>(null);
  const [choice, setChoice] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const groupId = useId();

  function load() {
    setMessage(null);
    setOk(false);
    startTransition(async () => {
      const res = await listTeamsMeetingsAction(companyId);
      if (!res.ok) {
        setMessage(res.message);
        return;
      }
      setMeetings(res.item ?? []);
    });
  }

  function connect() {
    if (!choice) return;
    setMessage(null);
    startTransition(async () => {
      const res = await connectTeamsMeetingAction(companyId, choice);
      if (!res.ok) {
        setOk(false);
        setMessage(res.message);
        return;
      }
      setOk(true);
      setChoice("");
      setMeetings(null);
      setMessage("Connected. The next transcript from this meeting will come in within 15 minutes of it ending.");
    });
  }

  return (
    <div style={{ marginTop: "var(--space-4)" }} data-testid="teams-meeting-picker">
      <h3 className={styles.h3}>Add a Teams meeting</h3>
      <p className={styles.subtitleInline}>
        Transcripts come in only from meetings run with transcription on. In the meeting&rsquo;s options in Teams, turn
        on &ldquo;Record and transcribe automatically&rdquo; so nobody has to remember.
      </p>

      {meetings === null ? (
        <div className={styles.submitRow}>
          <button type="button" className={styles.primaryButton} onClick={load} disabled={pending}>
            {pending ? "Reading the calendar…" : "Choose a meeting"}
          </button>
        </div>
      ) : meetings.length === 0 ? (
        <p className={styles.subtitleInline}>
          No Teams meetings on this account&rsquo;s calendar from two weeks ago to four weeks ahead.
        </p>
      ) : (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} aria-labelledby={groupId}>
          <legend id={groupId} className={styles.label}>
            Which meeting should AiMS analyse?
          </legend>
          {meetings.map((m) => (
            <label key={m.joinUrl} style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline", padding: "var(--space-1) 0" }}>
              <input
                type="radio"
                name={`${groupId}-meeting`}
                value={m.joinUrl}
                checked={choice === m.joinUrl}
                onChange={() => setChoice(m.joinUrl)}
                disabled={pending}
              />
              <span>
                <strong>{m.subject}</strong>{" "}
                <span className={styles.subtitleInline}>{when(m.nextOrLast, m.recurring)}</span>
              </span>
            </label>
          ))}
          <div className={styles.submitRow}>
            <button type="button" className={styles.primaryButton} onClick={connect} disabled={pending || !choice}>
              {pending ? "Connecting…" : "Connect meeting"}
            </button>
          </div>
        </fieldset>
      )}

      {message ? (
        <p role={ok ? "status" : "alert"} className={ok ? styles.successMessage : styles.errorMessage}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
