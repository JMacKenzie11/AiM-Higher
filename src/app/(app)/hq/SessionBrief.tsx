"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { generateSessionBriefAction } from "@/lib/hq/brief-actions";
import { markKeptAction } from "@/lib/commitments/actions";
import ui from "@/components/ui/ui.module.css";
import cc from "./coaching-calls.module.css";
import t from "./hq-tabs.module.css";

// Coaching notes (the session brief; renamed 2026-11-17), full width
// under "Your next session with {company}". Write coaching notes makes one
// model call (generateSessionBriefAction, brief.ts) and appends a row
// to session_briefs; the newest one the coach can see shows here, with
// Copy, Write new notes, and when it was written. A failed call says
// why and the button stays, so the page never fails on a brief.

function writtenWhen(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `Written today at ${time}`;
  return `Written ${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} at ${time}`;
}

export function SessionBrief({
  companyId,
  initial,
  newSince,
}: {
  companyId: string;
  initial: { id: string; content: string; createdAt: string } | null;
  // The newest call or meeting for the company, from the card.
  newSince: { label: string; heldOn: string } | null;
}) {
  const [brief, setBrief] = useState(initial);
  // Notes written before the newest call or meeting are out of date:
  // hidden, not deleted, with an offer to write new ones. Compared by
  // day: a meeting held the day the notes were written doesn't count.
  const outOfDate = Boolean(brief && newSince && newSince.heldOn.slice(0, 10) > brief.createdAt.slice(0, 10));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  const write = () =>
    start(async () => {
      setError(null);
      const r = await generateSessionBriefAction(companyId);
      if (!r.ok) return setError(r.message);
      setBrief({ id: r.briefId, content: r.content, createdAt: new Date().toISOString() });
    });

  const copy = async () => {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief.content);
      setCopied(true);
    } catch {
      // Clipboard unavailable here; nothing to do.
    }
  };

  return (
    <div className={t.notes}>
      <h3 className={t.columnHead}>Coaching notes</h3>
      {brief && !outOfDate ? (
        <>
          <div className={t.notesBody}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.content}</ReactMarkdown>
          </div>
          <div className={t.notesFoot}>
            <span className={t.caption} suppressHydrationWarning>
              {writtenWhen(brief.createdAt)}
            </span>
            <div className={cc.actions}>
              <button type="button" className={`${ui.btn} ${ui.btnSecondary}`} onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" className={`${ui.btn} ${ui.btnGhost}`} onClick={write} disabled={pending}>
                {pending ? "Writing..." : "Write new notes"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className={t.columnText}>
            {outOfDate && newSince
              ? `New since your last coaching notes: ${newSince.label}. Write new notes to take it in.`
              : "Notes for the session from all of this: what's working, what they set out to do, what's worth exploring, and three questions to open with."}
          </p>
          <div>
            <button type="button" className={`${ui.btn} ${ui.btnPrimary}`} onClick={write} disabled={pending}>
              {pending ? "Writing coaching notes..." : "Write coaching notes"}
            </button>
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className={cc.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

// Mark done on "Your promise": the coach keeps their own commitment
// with the same action the Commitments page uses (markKeptAction).
export function MarkDoneButton({ commitmentId }: { commitmentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={t.inlineButton}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await markKeptAction(commitmentId);
            if (!r.ok) return setError(r.message);
            router.refresh();
          })
        }
      >
        {pending ? "Marking..." : "Mark done"}
      </button>
      {error ? (
        <span role="alert" className={cc.error}>
          {" "}
          {error}
        </span>
      ) : null}
    </>
  );
}
