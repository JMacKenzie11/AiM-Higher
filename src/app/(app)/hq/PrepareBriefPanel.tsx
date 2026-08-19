"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { generateSessionBriefAction } from "@/lib/hq/brief-actions";
import type { SessionBriefRow } from "@/lib/hq/brief";
import styles from "./hq.module.css";

// Modal-style panel that generates a Session Brief on demand for a
// specific company. Every generation appends a new row to
// session_briefs — the panel shows the two most recent alongside the
// button so a guide can compare prep between weeks without hunting.
//
// Error handling: if the underlying Anthropic call errors, the action
// returns { ok: false, message } and the panel shows an inline retry.
// The page itself never fails.

export function PrepareBriefPanel({
  companyId,
  companyName,
  initialBriefs,
  onClose,
}: {
  companyId: string;
  companyName: string;
  initialBriefs: SessionBriefRow[];
  onClose: () => void;
}) {
  const [briefs, setBriefs] = useState(initialBriefs);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!copiedId) return;
    const t = setTimeout(() => setCopiedId(null), 2000);
    return () => clearTimeout(t);
  }, [copiedId]);

  function runGenerate() {
    setError(null);
    startTransition(async () => {
      const r = await generateSessionBriefAction(companyId);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      const newRow: SessionBriefRow = {
        id: r.briefId,
        company_id: companyId,
        generated_by: "",
        content_markdown: r.content,
        based_on_meeting_id: null,
        created_at: new Date().toISOString(),
      };
      setBriefs((prev) => [newRow, ...prev].slice(0, 2));
    });
  }

  async function copy(brief: SessionBriefRow) {
    try {
      await navigator.clipboard.writeText(brief.content_markdown);
      setCopiedId(brief.id);
    } catch {
      // Non-fatal — clipboard unavailable in some contexts.
    }
  }

  return (
    <div
      className={styles.briefBackdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prepare-brief-title"
        className={styles.briefDialog}
      >
        <div className={styles.briefHead}>
          <div>
            <p className={styles.briefEyebrow}>Session Brief</p>
            <h2 id="prepare-brief-title" className={styles.briefTitle}>
              Prepare for {companyName}
            </h2>
          </div>
          <button
            type="button"
            className={styles.briefClose}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.briefActions}>
          <button
            type="button"
            className={styles.briefPrimary}
            onClick={runGenerate}
            disabled={pending}
          >
            {pending ? "Generating…" : "Generate a new brief"}
          </button>
          {error ? (
            <span className={styles.briefError} role="alert">
              {error}
            </span>
          ) : null}
        </div>

        {briefs.length === 0 ? (
          <p className={styles.briefEmpty}>
            No briefs generated yet. Click above to generate one now.
          </p>
        ) : (
          <ol className={styles.briefList}>
            {briefs.map((b) => (
              <li key={b.id} className={styles.briefItem}>
                <div className={styles.briefItemHead}>
                  <span className={styles.briefItemWhen}>
                    {new Date(b.created_at).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    className={styles.briefCopy}
                    onClick={() => copy(b)}
                  >
                    {copiedId === b.id ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className={`${styles.briefBody} aims-prose`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {b.content_markdown}
                  </ReactMarkdown>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
