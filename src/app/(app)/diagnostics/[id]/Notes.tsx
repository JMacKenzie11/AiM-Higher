"use client";

import { useRef, useState } from "react";
import { addQuoteAction, saveNotesAction, suggestQuotesAction, updateParticipantAction, type NotesInput } from "@/lib/diagnostics/actions";
import type { NoteRow, ParticipantRow } from "@/lib/diagnostics/types";
import { useDxAction } from "../useDxAction";
import { ConversationRunner } from "./ConversationRunner";
import admin from "../../admin/companies/admin.module.css";
import styles from "../diagnostics.module.css";

// The notes panel: one person at a time, each box saved on blur.
export function Notes({ diagnosticId, participants, notes }: { diagnosticId: string; participants: ParticipantRow[]; notes: NoteRow[] }) {
  const [current, setCurrent] = useState(participants[0].id);
  const person = participants.find((p) => p.id === current)!;
  return (
    <div className={styles.checks}>
      <div className={admin.field}>
        <label className={admin.label} htmlFor="notes-person">
          Notes for
        </label>
        <select id="notes-person" className={admin.select} value={current} onChange={(e) => setCurrent(e.target.value)}>
          {participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.in_conversations ? ", had a conversation" : ""}
            </option>
          ))}
        </select>
      </div>
      <NotesForm key={current} diagnosticId={diagnosticId} person={person} note={notes.find((n) => n.participant_id === current) ?? null} />
    </div>
  );
}

function NotesForm({ diagnosticId, person, note }: { diagnosticId: string; person: ParticipantRow; note: NoteRow | null }) {
  const initial: Required<NotesInput> = {
    body: note?.body ?? "",
    peak_experience: note?.peak_experience ?? "",
    redeploy_wish: note?.redeploy_wish ?? "",
    destination_hours: note?.destination_hours == null ? "" : String(note.destination_hours),
  };
  const [f, setF] = useState(initial);
  const [last, setLast] = useState(initial);
  const [had, setHad] = useState(person.in_conversations);
  const body = useRef<HTMLTextAreaElement>(null);
  const save = useDxAction();
  const quote = useDxAction();
  const suggest = useDxAction();
  const [suggested, setSuggested] = useState<number | null>(null);
  const mark = useDxAction();
  const [running, setRunning] = useState(false);
  const [filled, setFilled] = useState(false);

  function blur(k: keyof NotesInput) {
    if (f[k] === last[k]) return;
    save.run(() => saveNotesAction(diagnosticId, person.id, { [k]: f[k] }), () => setLast((l) => ({ ...l, [k]: f[k] })));
  }

  function pull() {
    const el = body.current;
    if (!el) return;
    const words = el.value.slice(el.selectionStart, el.selectionEnd).trim();
    if (!words) {
      quote.setError("Select the words in the notes first.");
      return;
    }
    quote.run(() => addQuoteAction(diagnosticId, words));
  }

  // Finish on the conversation helper: the two short fields it drafted
  // go in where the lead has left them empty, and the person is marked
  // as having had their conversation.
  function finish(fields: { peak: string | null; redeploy: string | null }) {
    const patch: NotesInput = {};
    if (fields.peak && !f.peak_experience.trim()) patch.peak_experience = fields.peak;
    if (fields.redeploy && !f.redeploy_wish.trim()) patch.redeploy_wish = fields.redeploy;
    if (Object.keys(patch).length) {
      setF((x) => ({ ...x, ...patch }));
      save.run(() => saveNotesAction(diagnosticId, person.id, patch), () => setLast((l) => ({ ...l, ...patch })));
    }
    if (!had) {
      setHad(true);
      mark.run(() => updateParticipantAction(person.id, { in_conversations: true }));
    }
    setFilled(true);
  }

  return (
    <>
      {running ? (
        <ConversationRunner
          diagnosticId={diagnosticId}
          participantId={person.id}
          onBody={(b) => {
            setF((x) => ({ ...x, body: b }));
            setLast((l) => ({ ...l, body: b }));
          }}
          onFinish={finish}
          onClose={() => setRunning(false)}
        />
      ) : (
        <span className={styles.formRow}>
          <button
            type="button"
            className={`${styles.secondary} ${styles.small}`}
            onClick={() => {
              setFilled(false);
              setRunning(true);
            }}
          >
            Run a capacity conversation
          </button>
          {filled ? <span className={styles.status}>Notes filled in from the conversation. Check them, then suggest quotes.</span> : null}
        </span>
      )}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={had}
          disabled={mark.pending}
          onChange={(e) => {
            const v = e.target.checked;
            setHad(v);
            mark.run(() => updateParticipantAction(person.id, { in_conversations: v }));
          }}
        />
        Had a conversation
      </label>
      <div className={admin.field}>
        <label className={admin.label} htmlFor="notes-body">
          Notes
        </label>
        <textarea
          id="notes-body"
          ref={body}
          className={styles.textarea}
          rows={12}
          value={f.body}
          onChange={(e) => setF((x) => ({ ...x, body: e.target.value }))}
          onBlur={() => blur("body")}
          maxLength={8000}
        />
        <span className={styles.formRow}>
          {/* Keeps the selection: a mousedown on the button would blur the notes first. */}
          <button type="button" className={`${styles.secondary} ${styles.small}`} onMouseDown={(e) => e.preventDefault()} onClick={pull} disabled={quote.pending}>
            Pull a quote
          </button>
          <button
            type="button"
            className={`${styles.secondary} ${styles.small}`}
            disabled={suggest.pending}
            onClick={() => {
              setSuggested(null);
              suggest.run(() => suggestQuotesAction(diagnosticId, person.id), (r) => setSuggested((r as { added?: number }).added ?? 0));
            }}
          >
            {suggest.pending ? "Reading the notes" : "Suggest quotes"}
          </button>
          {quote.error ? <span className={styles.error} role="alert">{quote.error}</span> : quote.saved ? <span className={styles.status}>Added below, not yet approved.</span> : null}
          {suggest.error ? (
            <span className={styles.error} role="alert">{suggest.error}</span>
          ) : suggested ? (
            <span className={styles.status}>{suggested === 1 ? "One line" : `${suggested} lines`} added below, not yet approved.</span>
          ) : null}
        </span>
      </div>
      <div className={admin.field}>
        <label className={admin.label} htmlFor="notes-peak">
          Their best work (question 1)
        </label>
        <input
          id="notes-peak"
          className={admin.input}
          value={f.peak_experience}
          onChange={(e) => setF((x) => ({ ...x, peak_experience: e.target.value }))}
          onBlur={() => blur("peak_experience")}
          maxLength={2000}
        />
      </div>
      <div className={admin.field}>
        <label className={admin.label} htmlFor="notes-redeploy">
          Where they would put the hours (question 5)
        </label>
        <input
          id="notes-redeploy"
          className={admin.input}
          value={f.redeploy_wish}
          onChange={(e) => setF((x) => ({ ...x, redeploy_wish: e.target.value }))}
          onBlur={() => blur("redeploy_wish")}
          maxLength={2000}
        />
      </div>
      <div className={admin.field}>
        <label className={admin.label} htmlFor="notes-destination-hours">
          Hours a week toward the Capacity Destination
        </label>
        <input
          id="notes-destination-hours"
          className={admin.input}
          inputMode="decimal"
          value={f.destination_hours}
          onChange={(e) => setF((x) => ({ ...x, destination_hours: e.target.value }))}
          onBlur={() => blur("destination_hours")}
        />
        <span className={styles.status}>The readout adds these up by role.</span>
      </div>
      {save.error ? <span className={styles.error} role="alert">{save.error}</span> : save.pending ? <span className={styles.status}>Saving</span> : save.saved ? <span className={styles.status}>Saved</span> : null}
    </>
  );
}
