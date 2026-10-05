"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseSessionOffer } from "@/lib/aimee/session-offer-block";
import {
  getSessionOfferAction,
  startOfferedSessionAction,
  type OfferState,
} from "@/lib/aimee/session-offer-actions";
import styles from "./SessionOfferCard.module.css";

// Aimee's offer of a guided session (lib/aimee/session-offer-block.ts).
//
// The person sees the session and the summary Aimee will carry into
// it, and chooses. Talk it through starts the session (the server
// reads the offer from the saved message, never from here); Not now is
// sent as their message, so Aimee reads the decline in the thread.
// Typing anything else is a no as well: once a message follows the
// card, the card is settled and its buttons go.

// What each offer's card has learned, by message id, outside the
// component. ChatView builds its markdown renderers afresh on every
// render, so a card is unmounted and mounted again whenever the thread
// redraws (a reply streaming in below it, for one). Held in state
// alone, the name and the buttons went blank on each redraw and the
// server was asked again; seen on dev after Not now, 2026-10-05.
const known = new Map<string, OfferState>();

export function SessionOfferCard({
  raw,
  streaming,
  messageId,
  settled,
  onReply,
  onOpenConversation,
}: {
  raw: string;
  streaming: boolean;
  // The saved Aimee message; null until the reply has finished saving.
  messageId: string | null;
  // A message from the person follows this one.
  settled: boolean;
  // Sends a message as the person, as if they typed it.
  onReply?: (text: string) => void;
  // Where a started session opens. The panel opens it in the panel;
  // without this the Aimee page navigates to it.
  onOpenConversation?: (conversationId: string) => void;
}) {
  const router = useRouter();
  const offer = parseSessionOffer(raw);
  // undefined: not loaded yet.
  const [state, setStateOnly] = useState<OfferState | undefined>(
    messageId ? known.get(messageId) : undefined
  );
  const setState = (next: OfferState) => {
    if (messageId) known.set(messageId, next);
    setStateOnly(next);
  };
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!messageId || streaming) return;
    const cached = known.get(messageId);
    if (cached) {
      setStateOnly(cached);
      return;
    }
    let live = true;
    getSessionOfferAction(messageId)
      .then((s) => {
        known.set(messageId, s);
        if (live) setStateOnly(s);
      })
      .catch(() => live && setStateOnly({ ok: false, message: "" }));
    return () => {
      live = false;
    };
  }, [messageId, streaming]);

  if (!offer) {
    return streaming ? (
      <div className={styles.pending} role="status" aria-live="polite">
        Writing the offer…
      </div>
    ) : null;
  }

  const open = (id: string) => {
    if (onOpenConversation) onOpenConversation(id);
    else router.push(`/ask-aimee/${id}`);
  };

  const start = () => {
    if (!messageId) return;
    setError(null);
    startTransition(async () => {
      const result = await startOfferedSessionAction(messageId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (state?.ok) setState({ ...state, startedConversationId: result.conversationId });
      open(result.conversationId);
    });
  };

  // No title until the server has said which session this is: a
  // placeholder name that then changes reads as a different offer.
  const title = state?.ok ? state.title : null;
  const started = state?.ok ? state.startedConversationId : null;
  const canChoose = state?.ok === true && !started && !settled && !streaming && Boolean(messageId);

  return (
    <article
      className={canChoose || started ? styles.card : `${styles.card} ${styles.cardSettled}`}
      data-testid="session-offer-card"
    >
      <p className={styles.eyebrow}>Guided session</p>
      {title ? <h3 className={styles.title}>{title}</h3> : null}
      <p className={styles.lead}>Aimee will start with:</p>
      <p className={styles.summary}>{offer.summary}</p>

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}

      {started ? (
        <div className={styles.actions}>
          <span className={styles.muted}>Started.</span>
          <button type="button" className={styles.primaryButton} onClick={() => open(started)}>
            Open the session
          </button>
        </div>
      ) : canChoose ? (
        <div className={styles.actions}>
          <button type="button" className={styles.primaryButton} onClick={start} disabled={pending}>
            {pending ? "Starting…" : "Talk it through"}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => onReply?.("Not now.")}
            disabled={pending || !onReply}
          >
            Not now
          </button>
        </div>
      ) : state && !state.ok && state.message ? (
        <p className={styles.muted}>{state.message}</p>
      ) : settled && state?.ok ? (
        <p className={styles.muted}>Not started.</p>
      ) : null}
    </article>
  );
}
