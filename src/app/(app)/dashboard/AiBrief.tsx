"use client";

import { useEffect, useState } from "react";
import styles from "./dashboard.module.css";

// Types the cached AI brief out character-by-character on mount so
// every visit feels alive, without spending an API call. Respects
// prefers-reduced-motion — motion-sensitive users see the full text
// instantly.

export type AiBriefProps = {
  content: string;
  generatedAt: string;
};

const CHAR_INTERVAL_MS = 12; // ~80 chars/sec — brisk but readable

export function AiBrief({ content, generatedAt }: AiBriefProps) {
  const [visible, setVisible] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setVisible(content.length);
      setDone(true);
      return;
    }

    let cancelled = false;
    let i = 0;

    function step() {
      if (cancelled) return;
      // Advance a few chars per tick so long briefs still feel snappy,
      // but keep it visible enough to look like typing.
      i = Math.min(content.length, i + 2);
      setVisible(i);
      if (i >= content.length) {
        setDone(true);
        return;
      }
      window.setTimeout(step, CHAR_INTERVAL_MS);
    }

    const start = window.setTimeout(step, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [content]);

  const shown = content.slice(0, visible);

  return (
    <p className={styles.briefBody}>
      <span>{shown}</span>
      {!done ? <span className={styles.briefCursor} aria-hidden="true" /> : null}
      <span className={styles.briefTimestamp}>
        Refreshed {formatRelative(generatedAt)}
      </span>
    </p>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMinutes = Math.max(0, Math.round((now - then) / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
