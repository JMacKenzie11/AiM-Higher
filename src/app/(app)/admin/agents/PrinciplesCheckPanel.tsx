"use client";

import { useEffect, useState } from "react";
import {
  checkAgentPrinciplesAction,
  type PrinciplesCheckView,
} from "@/lib/practices/version-actions";
import admin from "../companies/admin.module.css";
import styles from "./hub.module.css";

// The prompt about to be published, checked against the AiMS coaching
// principles (lib/practices/principles-check.ts, 0256). It warns and
// never blocks: when the check finds something, or cannot run, the
// person gives a reason, which is kept with the version.
//
// The parent holds the result, because Publish sends its id and the
// reason; this runs the check whenever the prompt changes.

export type PrinciplesState = {
  check: PrinciplesCheckView | null;
  reason: string;
};

// Whether Publish can go: the check has run, and a warning has a reason.
export function principlesReady(s: PrinciplesState): boolean {
  if (!s.check) return false;
  const warned = s.check.status === "failed" || s.check.conflicts.length > 0;
  return !warned || s.reason.trim().length > 0;
}

export function PrinciplesCheckPanel({
  agentRowId,
  prompt,
  state,
  onChange,
  idPrefix,
}: {
  agentRowId: string;
  prompt: string;
  state: PrinciplesState;
  onChange: (s: PrinciplesState) => void;
  idPrefix: string;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let live = true;
    setRunning(true);
    setError(null);
    onChange({ check: null, reason: state.reason });
    checkAgentPrinciplesAction(agentRowId, prompt)
      .then((r) => {
        if (!live) return;
        if (r.ok) onChange({ check: r.check, reason: state.reason });
        else setError(r.message);
      })
      .catch(() => live && setError("Couldn't run the check. Try again."))
      .finally(() => live && setRunning(false));
    return () => {
      live = false;
    };
    // The check runs for a prompt, and again when asked; not on every
    // keystroke of the reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRowId, prompt, run]);

  const check = state.check;
  const warned = check ? check.status === "failed" || check.conflicts.length > 0 : false;

  return (
    <section className={styles.principles} data-testid="agent-config-principles" aria-live="polite">
      <p className={admin.label}>Checked against the AiMS coaching principles</p>
      {running ? (
        <p className={admin.fieldHint}>Checking the prompt against the coaching principles…</p>
      ) : error ? (
        <>
          <p role="alert" className={admin.warningMessage}>{error}</p>
          <button type="button" className={admin.ghostButton} onClick={() => setRun((n) => n + 1)}>
            Check again
          </button>
        </>
      ) : check && check.status === "failed" ? (
        <>
          <p className={admin.warningMessage}>
            The check could not run this time. You can check again, or publish with a reason.
          </p>
          <button type="button" className={admin.ghostButton} onClick={() => setRun((n) => n + 1)}>
            Check again
          </button>
        </>
      ) : check && check.conflicts.length === 0 ? (
        <p className={styles.configSource}>Nothing in this prompt pulls against the coaching principles.</p>
      ) : check ? (
        <>
          <p className={admin.warningMessage}>
            {check.conflicts.length === 1
              ? "One instruction in this prompt pulls against the coaching principles."
              : `${check.conflicts.length} instructions in this prompt pull against the coaching principles.`}{" "}
            The principles win when Aimee runs, but the agent is clearer without the conflict.
          </p>
          <ul className={styles.principlesList}>
            {check.conflicts.map((c, i) => (
              <li key={i} className={styles.principlesItem}>
                <p>
                  <strong>{c.principle}</strong>
                </p>
                <blockquote className={styles.principlesQuote}>{c.quote}</blockquote>
                <p>{c.why}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {warned ? (
        <div className={admin.field}>
          <label className={admin.label} htmlFor={`${idPrefix}-principles-reason`}>
            Why publish with these warnings?
          </label>
          <textarea
            id={`${idPrefix}-principles-reason`}
            className={admin.input}
            value={state.reason}
            onChange={(e) => onChange({ check, reason: e.target.value })}
            rows={2}
          />
          <p className={admin.fieldHint}>Required. It is kept with the version, beside the warnings.</p>
        </div>
      ) : null}
    </section>
  );
}
