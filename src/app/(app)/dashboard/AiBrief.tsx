"use client";

import { useEffect, useState } from "react";
import styles from "./dashboard.module.css";

// Types the cached AI brief out character-by-character the FIRST
// time the user sees a given generation, then just renders it
// instantly on subsequent visits until the brief refreshes to a
// newer generatedAt. Also respects prefers-reduced-motion — motion-
// sensitive users see the full text instantly regardless.
//
// Memory lives in localStorage keyed by generatedAt (unique per
// brief). If the key hasn't been seen, animate + record; otherwise
// skip the animation.

export type AiBriefProps = {
  content: string;
  generatedAt: string;
};

const CHAR_INTERVAL_MS = 8; // ~250 chars/sec — brisk enough to feel
// like reveal, not slow typing. Kept the effect for delight on
// first view; a slightly faster tempo + no pre-delay closes the
// perceptual gap with the Suspense skeleton so the whole thing
// reads as one reveal moment rather than "loading, then typing".
const SEEN_STORAGE_KEY = "aims.brief.lastSeenGeneratedAt";

export function AiBrief({ content, generatedAt }: AiBriefProps) {
  // Start fully rendered by default. If the effect below decides an
  // animation is warranted, it flips back to 0 and steps up. This
  // avoids an SSR/CSR mismatch flash: the server render matches the
  // initial client render, then the effect kicks in.
  const [visible, setVisible] = useState(content.length);
  const [done, setDone] = useState(true);

  useEffect(() => {
    // Same-brief revisits: skip the animation.
    let alreadySeen = false;
    try {
      alreadySeen =
        window.localStorage?.getItem(SEEN_STORAGE_KEY) === generatedAt;
    } catch {
      // Private mode / disabled storage — treat as "not seen" and
      // animate. Best UX degradation given we can't remember.
    }
    if (alreadySeen) {
      setVisible(content.length);
      setDone(true);
      return;
    }

    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setVisible(content.length);
      setDone(true);
      try {
        window.localStorage?.setItem(SEEN_STORAGE_KEY, generatedAt);
      } catch {
        /* ignore */
      }
      return;
    }

    // Fresh brief — animate.
    setDone(false);
    setVisible(0);

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
        try {
          window.localStorage?.setItem(SEEN_STORAGE_KEY, generatedAt);
        } catch {
          /* ignore */
        }
        return;
      }
      window.setTimeout(step, CHAR_INTERVAL_MS);
    }

    // No pre-delay — the Suspense skeleton just resolved, so start
    // typing immediately for a single perceived reveal beat.
    step();
    return () => {
      cancelled = true;
    };
  }, [content, generatedAt]);

  const shown = content.slice(0, visible);

  return (
    <>
      <p className={styles.briefBody}>
        {shown}
        {!done ? (
          <span className={styles.briefCursor} aria-hidden="true" />
        ) : null}
      </p>
      {done ? (
        <span className={styles.briefTimestamp}>
          Refreshed {formatRelative(generatedAt)}
        </span>
      ) : null}
    </>
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
