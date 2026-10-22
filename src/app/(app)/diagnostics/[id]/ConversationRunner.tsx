"use client";

import { useState } from "react";
import { conversationTurnAction } from "@/lib/diagnostics/actions";
import { CONVERSATION_GUIDE, OPENING_LINE } from "@/lib/diagnostics/conversation-guide";
import type { Turn } from "@/lib/diagnostics/conversation";
import { useDxAction } from "../useDxAction";
import admin from "../../admin/companies/admin.module.css";
import styles from "../diagnostics.module.css";

// RUN A CAPACITY CONVERSATION (phase 3), for one person, inside their
// notes. The lead reads the opening line, then each question; types
// what the person said and adds it, which saves it to the notes under
// the question; and gets one follow-up to ask, or a sign the answer is
// enough. Finish offers the two short fields from questions 1 and 5.
// Lives here only: no Agent Hub entry and no picker anywhere else.
export function ConversationRunner({
  diagnosticId,
  participantId,
  onBody,
  onFinish,
  onClose,
}: {
  diagnosticId: string;
  participantId: string;
  onBody: (body: string) => void;
  onFinish: (fields: { peak: string | null; redeploy: string | null }) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState(-1);
  const [said, setSaid] = useState("");
  const [turn, setTurn] = useState<Turn | null>(null);
  const [fields, setFields] = useState<{ peak: string | null; redeploy: string | null }>({ peak: null, redeploy: null });
  const [note, setNote] = useState<string | null>(null);
  const { pending, error, run } = useDxAction();
  const last = question === CONVERSATION_GUIDE.length - 1;

  function add() {
    run(
      () => conversationTurnAction(diagnosticId, participantId, question, said),
      (r) => {
        const out = r as { body?: string; turn?: Turn | null; message?: string };
        if (out.body != null) onBody(out.body);
        setSaid("");
        setTurn(out.turn ?? null);
        setNote(out.message ?? null);
        if (out.turn) setFields((f) => ({ peak: out.turn!.peakExperience ?? f.peak, redeploy: out.turn!.redeployWish ?? f.redeploy }));
      }
    );
  }

  function go(to: number) {
    setQuestion(to);
    setTurn(null);
    setNote(null);
  }

  return (
    <div className={styles.runner} aria-label="Run a capacity conversation">
      {question < 0 ? (
        <>
          <span className={admin.label}>Read this first</span>
          <p className={styles.opening}>{OPENING_LINE}</p>
          <span className={styles.formRow}>
            <button type="button" className={`${styles.primary} ${styles.small}`} onClick={() => go(0)}>
              Start with question 1
            </button>
            <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={onClose}>
              Close
            </button>
          </span>
        </>
      ) : (
        <>
          <span className={admin.label}>
            Question {question + 1} of {CONVERSATION_GUIDE.length}
          </span>
          <p className={styles.opening}>{CONVERSATION_GUIDE[question]}</p>
          {turn?.followUp ? (
            <p className={styles.status}>
              You could ask: <strong>{turn.followUp}</strong>
            </p>
          ) : turn ? (
            <p className={styles.status}>That answers it. Go on when you&apos;re ready.</p>
          ) : null}
          <div className={admin.field}>
            <label className={admin.label} htmlFor="runner-said">
              What they said
            </label>
            <textarea id="runner-said" className={styles.textarea} rows={4} value={said} onChange={(e) => setSaid(e.target.value)} maxLength={4000} />
          </div>
          <span className={styles.formRow}>
            <button type="button" className={`${styles.primary} ${styles.small}`} onClick={add} disabled={pending || !said.trim()}>
              {pending ? "Adding" : "Add to notes"}
            </button>
            <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => go(question - 1)} disabled={pending || question === 0}>
              Back
            </button>
            {last ? (
              <button
                type="button"
                className={`${styles.secondary} ${styles.small}`}
                disabled={pending}
                onClick={() => {
                  onFinish(fields);
                  onClose();
                }}
              >
                Finish
              </button>
            ) : (
              <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => go(question + 1)} disabled={pending}>
                Next question
              </button>
            )}
            {error ? <span className={styles.error} role="alert">{error}</span> : note ? <span className={styles.status}>{note}</span> : null}
          </span>
        </>
      )}
    </div>
  );
}
