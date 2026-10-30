"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signProposalAction } from "@/lib/diagnostics/proposal-actions";
import styles from "../../portal.module.css";

// The owner's signature (0312): their typed name, a tick, and the
// fingerprint of the version on the page, so a version that changed
// while they read is refused rather than signed.
export function SignBox({ id, hash, ownerName, clientName, leadName, leadDate }: { id: string; hash: string; ownerName: string; clientName: string; leadName: string; leadDate: string }) {
  const router = useRouter();
  const [name, setName] = useState(ownerName);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = name.trim().length > 1 && agreed;
  return (
    <form
      className={styles.card}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await signProposalAction(id, { name, hash, agreed });
          if (!r.ok) setError(r.message);
          else router.refresh();
        });
      }}
    >
      <h2 className={styles.cardTitle}>Sign this proposal</h2>
      <p className={styles.muted}>
        {leadName} signed for AiMS Institute on {leadDate}.
      </p>
      <label className={styles.field} htmlFor="owner-sign-name">
        Type your full name to sign
        <input id="owner-sign-name" className={styles.input} value={name} maxLength={200} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className={styles.check} htmlFor="owner-sign-agree">
        <input id="owner-sign-agree" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>I have read this proposal and agree to its terms on behalf of {clientName}.</span>
      </label>
      <button type="submit" className={styles.primaryButton} disabled={!ready || pending}>
        {pending ? "Signing" : "Sign proposal"}
      </button>
      <p className={styles.muted}>We record your name, the time, your IP address and this exact version.</p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
