"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { parseVividVision } from "@/lib/foundation/vivid-vision";
import {
  getVividVisionCardStateAction,
  saveVividVisionAction,
  type VividVisionCardState,
} from "@/lib/foundation/vivid-vision-actions";
import styles from "./VividVisionCard.module.css";

// The Vivid Vision agent's finished document (lib/foundation/vivid-vision.ts).
//
// Shown as it will read on the One-Page Plan's Vision card. Nothing is
// saved until the leader presses Save, and saving replaces what the
// Vision card holds, so the card says so when it holds something else.
// Only the person who started the conversation, and only if they can
// edit the One-Page Plan, sees Save; anyone else can read and copy it.

export function VividVisionCard({
  raw,
  streaming,
  conversationId,
  messageId,
}: {
  raw: string;
  streaming: boolean;
  conversationId: string;
  // The saved Aimee message; null until the reply has finished saving.
  messageId: string | null;
}) {
  const vision = parseVividVision(raw);
  // undefined: not loaded yet. null: not this person's to save.
  const [state, setState] = useState<VividVisionCardState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!messageId || streaming) return;
    let live = true;
    getVividVisionCardStateAction(conversationId, messageId)
      .then((s) => live && setState(s))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, [conversationId, messageId, streaming]);

  if (!vision) {
    return (
      <div className={styles.pending} role="status" aria-live="polite">
        {streaming ? "Writing your vivid vision…" : "The vivid vision did not come through this time. Ask Aimee to write it again."}
      </div>
    );
  }

  const save = () => {
    if (!messageId) return;
    setError(null);
    startTransition(async () => {
      const result = await saveVividVisionAction({ conversationId, messageId });
      if (result.ok) setState({ current: vision.text, savedThis: true });
      else setError(result.message);
    });
  };

  const copy = () => {
    void navigator.clipboard?.writeText(vision.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const replaces = state?.current && !state.savedThis;

  return (
    <article className={styles.card} data-testid="vivid-vision-card">
      <p className={styles.eyebrow}>Vivid Vision</p>
      <h3 className={styles.title}>{vision.title}</h3>
      {vision.rest ? <p className={styles.body}>{vision.rest}</p> : null}
      {streaming ? null : (
        <div className={styles.footer}>
          {state?.savedThis ? (
            <p className={styles.saved} role="status">
              <strong>Saved to your One-Page Plan.</strong>{" "}
              <Link href="/foundation#vision">Open the One-Page Plan</Link>
            </p>
          ) : state ? (
            <>
              {replaces ? (
                <p className={styles.muted}>Saving replaces the vision on your One-Page Plan.</p>
              ) : null}
              <div className={styles.actions}>
                <button type="button" className={styles.primaryButton} onClick={save} disabled={pending}>
                  {pending ? "Saving…" : "Save to the One-Page Plan"}
                </button>
                <button type="button" className={styles.secondaryButton} onClick={copy}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </>
          ) : (
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </article>
  );
}
