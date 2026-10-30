"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NotesEditor, type NotesDoc } from "@/components/tiptap/NotesEditor";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  deleteProposalDraftAction,
  newProposalVersionAction,
  publishProposalAction,
  saveProposalSectionsAction,
  saveProposalTitleAction,
} from "@/lib/diagnostics/proposal-actions";
import type { ProposalSection } from "@/lib/diagnostics/proposals";
import { useDxAction } from "../../useDxAction";
import admin from "../../../admin/companies/admin.module.css";
import dx from "../../diagnostics.module.css";
import styles from "../proposals.module.css";

// The draft: the title and one editor per section. Each editor saves
// when the writer leaves it, sending every section's latest document,
// so saves one after another never undo each other.

export function ProposalEditor({ id, title, sections }: { id: string; title: string; sections: ProposalSection[] }) {
  const latest = useRef(sections);
  const [t, setT] = useState(title);
  const [lastT, setLastT] = useState(title);
  const { pending, error, saved, run } = useDxAction();
  const save = (key: string, doc: NotesDoc) => {
    latest.current = latest.current.map((s) => (s.key === key ? { ...s, doc: doc as ProposalSection["doc"] } : s));
    run(() => saveProposalSectionsAction(id, latest.current));
  };
  return (
    <div className={styles.sections}>
      <section className={dx.card}>
        <div className={dx.body}>
          <div className={admin.field}>
            <label className={admin.label} htmlFor="proposal-title">
              Title
            </label>
            <input
              id="proposal-title"
              className={admin.input}
              value={t}
              maxLength={200}
              onChange={(e) => setT(e.target.value)}
              onBlur={() => {
                if (t.trim() === lastT.trim()) return;
                run(() => saveProposalTitleAction(id, t), () => setLastT(t));
              }}
            />
          </div>
          <span className={dx.status} role="status" aria-live="polite">
            {error ? <span className={dx.error}>{error}</span> : pending ? "Saving" : saved ? "Saved" : "Each section saves when you click away from it."}
          </span>
        </div>
      </section>
      {sections.map((s) => (
        <section key={s.key} className={dx.card} aria-labelledby={`sec-${s.key}`}>
          <div className={dx.cardHeader}>
            <h2 id={`sec-${s.key}`} className={styles.sectionTitle}>
              {s.title}
            </h2>
          </div>
          <div className={dx.body}>
            <NotesEditor initial={s.doc as NotesDoc} label={s.title} onBlur={(doc) => save(s.key, doc)} />
          </div>
        </section>
      ))}
    </div>
  );
}

export function SignAndPublish({ id, defaultName, ownerLabel, blocker }: { id: string; defaultName: string; ownerLabel: string; blocker: string | null }) {
  const [name, setName] = useState(defaultName);
  const [agreed, setAgreed] = useState(false);
  const [asking, setAsking] = useState(false);
  const { pending, error, run } = useDxAction();
  const ready = !blocker && name.trim().length > 1 && agreed;
  return (
    <div className={dx.body}>
      <div className={admin.field}>
        <label className={admin.label} htmlFor="lead-sign-name">
          Type your full name to sign
        </label>
        <input id="lead-sign-name" className={`${admin.input} ${styles.signName}`} value={name} maxLength={200} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </div>
      <label className={styles.check} htmlFor="lead-sign-agree">
        <input id="lead-sign-agree" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>I am signing this proposal on behalf of AiMS Institute.</span>
      </label>
      {blocker ? <p className={dx.warnText}>{blocker}</p> : null}
      <button type="button" className={dx.primary} disabled={!ready || pending} onClick={() => setAsking(true)}>
        Sign and publish
      </button>
      <p className={dx.status}>Once you sign, this version locks and {ownerLabel} sees it on their dashboard to sign.</p>
      {error ? (
        <p className={dx.error} role="alert">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={asking}
        tone="primary"
        title="Sign and publish this proposal?"
        message={`It locks once you sign. ${ownerLabel} can then read and sign it. To change it later you make a new version, which they sign again.`}
        confirmLabel="Sign and publish"
        cancelLabel="Keep editing"
        pending={pending}
        onConfirm={() => run(() => publishProposalAction(id, { signedName: name, agreed }), () => setAsking(false))}
        onCancel={() => setAsking(false)}
        onDismiss={() => setAsking(false)}
      />
    </div>
  );
}

export function NewVersionButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const { pending, error, run } = useDxAction();
  return (
    <span className={dx.formRow}>
      <button type="button" className={`${dx.secondary} ${dx.small}`} disabled={pending} onClick={() => run(() => newProposalVersionAction(id), (r) => r.id && router.push(`/diagnostics/proposals/${r.id}`))}>
        {label}
      </button>
      {error ? <span className={dx.error} role="alert">{error}</span> : null}
    </span>
  );
}

export function DeleteDraftButton({ id }: { id: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const { pending, error, run } = useDxAction();
  return (
    <span className={dx.formRow}>
      <button type="button" className={`${dx.secondary} ${dx.small}`} disabled={pending} onClick={() => setAsking(true)}>
        Delete this draft
      </button>
      {error ? <span className={dx.error} role="alert">{error}</span> : null}
      <ConfirmDialog
        open={asking}
        title="Delete this draft?"
        message="The draft goes, and anything written in it. Signed and published versions stay."
        confirmLabel="Delete the draft"
        cancelLabel="Keep it"
        pending={pending}
        onConfirm={() => run(() => deleteProposalDraftAction(id), (r) => r.id && router.push(`/diagnostics/clients/${r.id}`))}
        onCancel={() => setAsking(false)}
        onDismiss={() => setAsking(false)}
      />
    </span>
  );
}

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={styles.copyRow}>
      <input ref={ref} className={admin.input} readOnly value={url} aria-label="Link to the proposal" onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className={`${dx.secondary} ${dx.small}`}
        onClick={() =>
          navigator.clipboard
            ?.writeText(url)
            .then(() => setCopied(true))
            .catch(() => ref.current?.select())
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
