"use client";

import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { draftPledgeAction, updateDiagnosticAction } from "@/lib/diagnostics/actions";
import { useDxAction } from "../useDxAction";
import { shortDate } from "../format";
import admin from "../../admin/companies/admin.module.css";
import styles from "../diagnostics.module.css";

// The owner's capacity pledge: a draft in their voice to edit, Copy to
// paste it into their email, and Mark as sent once they have sent it.
// An owner who will not send it is not a client yet. Draft in the
// owner's voice (phase 3) rewrites it from the kickoff answers; the
// draft lands in the box and saves like anything typed there.
export function Pledge({ diagnosticId, saved, draft, sentAt }: { diagnosticId: string; saved: string | null; draft: string; sentAt: string | null }) {
  const id = useId();
  const [text, setText] = useState(saved ?? draft);
  const [last, setLast] = useState(saved ?? "");
  const [copied, setCopied] = useState(false);
  const { pending, error, run } = useDxAction();
  const drafting = useDxAction();
  const [confirming, setConfirming] = useState(false);

  function redraft() {
    setConfirming(false);
    drafting.run(
      () => draftPledgeAction(diagnosticId),
      (r) => {
        const next = (r as { text?: string }).text;
        if (!next) return;
        setText(next);
        run(() => updateDiagnosticAction(diagnosticId, { pledge_text: next }), () => setLast(next));
      }
    );
  }

  function save() {
    if (text === last) return;
    run(() => updateDiagnosticAction(diagnosticId, { pledge_text: text }), () => setLast(text));
  }

  async function copy() {
    save();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={admin.field}>
      <label className={admin.label} htmlFor={id}>
        Message from the owner to the team
      </label>
      <textarea id={id} className={styles.textarea} rows={12} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} maxLength={4000} />
      <span className={styles.formRow}>
        <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => (text.trim() && text !== draft ? setConfirming(true) : redraft())} disabled={pending || drafting.pending || Boolean(sentAt)}>
          {drafting.pending ? "Drafting" : "Draft in the owner's voice"}
        </button>
        <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={copy} disabled={pending}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className={`${styles.secondary} ${styles.small}`}
          disabled={pending}
          onClick={() => run(() => updateDiagnosticAction(diagnosticId, { pledge_text: text, pledge_sent: !sentAt }), () => setLast(text))}
        >
          {sentAt ? "Mark as not sent" : "Mark as sent"}
        </button>
        <span className={styles.status}>{sentAt ? `Sent ${shortDate(sentAt)}` : "Not sent yet"}</span>
        {error || drafting.error ? <span className={styles.error} role="alert">{error ?? drafting.error}</span> : null}
      </span>
      <ConfirmDialog
        open={confirming}
        tone="primary"
        title="Replace the message?"
        message="A new draft in the owner's voice replaces what's in the box now."
        confirmLabel="Replace it"
        onCancel={() => setConfirming(false)}
        onConfirm={redraft}
      />
    </div>
  );
}
