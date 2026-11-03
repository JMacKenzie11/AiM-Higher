"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { parseVividVision, splitBold, type VividVisionDoc } from "@/lib/foundation/vivid-vision";
import {
  getVividVisionCardStateAction,
  saveVividVisionAction,
  type VividVisionCardState,
} from "@/lib/foundation/vivid-vision-actions";
import { GoogleDocButton } from "./GoogleDocButton";
import styles from "./VividVisionCard.module.css";

// The Vivid Vision agent's finished document (lib/foundation/vivid-vision.ts).
//
// Shown with its sections and bold lines, as the PDF lays it out.
// Download PDF and Save to Google Docs (0318) are for anyone who can
// see the card, once the reply has saved (both read the saved message). Nothing is saved to
// the One-Page Plan until the leader presses Save, and saving replaces
// what the Vision card holds (as plain text), so the card says so when
// it holds something else. Only the person who started the
// conversation, and only if they can edit the One-Page Plan, sees
// Save; anyone else can read, copy and download it.

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
      if (result.ok) setState({ current: vision.saveText, savedThis: true });
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
  const pdfHref = messageId
    ? `/api/vivid-vision/pdf?conversation=${encodeURIComponent(conversationId)}&message=${encodeURIComponent(messageId)}`
    : null;
  // Download PDF and Save to Google Docs: for anyone who can see the
  // card, once the reply has saved.
  const download = pdfHref ? (
    <a className={styles.secondaryButton} href={pdfHref} download>
      Download PDF
    </a>
  ) : null;

  return (
    <article className={styles.card} data-testid="vivid-vision-card">
      <p className={styles.eyebrow}>Vivid Vision</p>
      <h3 className={styles.title}>{vision.title}</h3>
      <VisionBody doc={vision.doc} />
      {streaming ? null : (
        <div className={styles.footer}>
          {state?.savedThis ? (
            <p className={styles.saved} role="status">
              <strong>Saved to your One-Page Plan.</strong>{" "}
              <Link href="/foundation#vision">Open the One-Page Plan</Link>
            </p>
          ) : null}
          {state && !state.savedThis && replaces ? (
            <p className={styles.muted}>
              {vision.doc.summary.length
                ? "Saving puts the summary on your One-Page Plan, replacing the vision there."
                : "Saving replaces the vision on your One-Page Plan."}
            </p>
          ) : null}
          {/* One row, whose buttons come and go, so each keeps its place
              (and its state) as the card's own state arrives. */}
          <div className={styles.actions}>
            {state && !state.savedThis ? (
              <button type="button" className={styles.primaryButton} onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save to the One-Page Plan"}
              </button>
            ) : null}
            {download}
            <button type="button" className={styles.secondaryButton} onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
            {/* Last, so its status line wraps under the whole row. */}
            {messageId ? <GoogleDocButton conversationId={conversationId} messageId={messageId} /> : null}
          </div>
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

function Rich({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((run, n) => (run.bold ? <strong key={n}>{run.text}</strong> : <span key={n}>{run.text}</span>))}
    </>
  );
}

// The document in its parts, in the PDF's order.
function VisionBody({ doc }: { doc: VividVisionDoc }) {
  return (
    <div className={styles.body}>
      {doc.tagline ? <p className={styles.tagline}>{doc.tagline}</p> : null}
      {doc.intro.map((p, n) => (
        <p key={`i${n}`}>
          <Rich text={p} />
        </p>
      ))}
      {doc.story.map((sec, n) => (
        <section key={`s${n}`}>
          <h4 className={styles.sectionHead}>
            <span className={styles.num}>{String(n + 1).padStart(2, "0")}</span> {sec.headline}
          </h4>
          {sec.paragraphs.map((p, m) => (
            <p key={m}>
              <Rich text={p} />
            </p>
          ))}
        </section>
      ))}
      {doc.proof.groups.length ? (
        <section>
          <h4 className={styles.sectionHead}>Proof Points</h4>
          {doc.proof.groups.map((g, n) => (
            <div key={n}>
              {g.name ? <p className={styles.groupName}>{g.name}</p> : null}
              <ul>
                {g.items.map((item, m) => (
                  <li key={m}>
                    <Rich text={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
      {doc.protect.items.length ? (
        <section>
          <h4 className={styles.sectionHead}>What We Protect</h4>
          <ul>
            {doc.protect.items.map((item, n) => (
              <li key={n}>
                <Rich text={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {doc.themes.items.length ? (
        <section>
          <h4 className={styles.sectionHead}>Strategic Focus Themes</h4>
          <ol>
            {doc.themes.items.map((t, n) => (
              <li key={n}>
                <strong>{t.name}</strong>
                {t.subtitle ? <span className={styles.subtitle}> {t.subtitle}</span> : null}
                {t.body.map((b, m) => (
                  <p key={m}>
                    <Rich text={b} />
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {doc.closing.map((c, n) => (
        <p key={`c${n}`} className={styles.closing}>
          <Rich text={c} />
        </p>
      ))}
      {doc.summary.length ? (
        <section className={styles.summary} data-testid="vivid-vision-summary">
          <h4 className={styles.sectionHead}>For your One-Page Plan</h4>
          {doc.summary.map((p, n) => (
            <p key={n}>
              <Rich text={p} />
            </p>
          ))}
        </section>
      ) : null}
    </div>
  );
}
