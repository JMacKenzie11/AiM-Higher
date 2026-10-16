"use client";

import { useEffect, useState } from "react";
import styles from "./dashboard.module.css";

// Types the cached AI brief out character-by-character the FIRST
// time the user sees a given generation, then just renders it
// instantly on subsequent visits until the brief refreshes to a
// newer generatedAt. Also respects prefers-reduced-motion — motion-
// sensitive users see the full text instantly regardless. The "typing"
// is a colour reveal over text that is already laid out in full, so
// the card never changes height while it runs.
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

  // The whole text is laid out from the first paint, so the line breaks
  // and the card's height are final before the reveal starts and nothing
  // below the card moves (audit P-01: typing grew the card a line at a
  // time and pushed the board down, CLS 0.88). The reveal is colour
  // only: the unrevealed tail is transparent. Both parts sit in the one
  // paragraph, so a screen reader reads the text once, whole.
  const shown = content.slice(0, visible);
  const rest = content.slice(visible);

  return (
    <>
      <p className={styles.briefBody}>
        {shown}
        {!done ? (
          <span className={styles.briefCursor} aria-hidden="true" />
        ) : null}
        {rest ? <span className={styles.briefUnrevealed}>{rest}</span> : null}
      </p>
      {/* Always rendered so its line is reserved; hidden until the
          reveal finishes. */}
      <span
        className={styles.briefTimestamp}
        style={done ? undefined : { visibility: "hidden" }}
        aria-hidden={done ? undefined : true}
      >
        Refreshed {formatRelative(generatedAt)}
      </span>
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
