"use client";

import { useState } from "react";
import { parsePracticeScript } from "@/lib/practices/parse-script";
import styles from "./practice.module.css";

// Renders a practice script emitted by the assistant. Given the raw
// text of a `script` fenced code block, tries to parse the JSON and
// render as a styled card; falls back to a "still assembling" note
// during streaming or if the JSON is malformed. The card is the
// take-home artefact of a practice — the Copy button copies ONLY
// better_approach because that's what the person walks into the
// room with.

export function ScriptCard({
  raw,
  streaming,
}: {
  raw: string;
  streaming: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const script = parsePracticeScript(raw);

  if (!script) {
    // Streaming half-open block, or a malformed final payload. Either
    // way, showing the JSON to the user reads as an error state — a
    // muted placeholder is a better UX than a wall of braces.
    return (
      <div className={styles.scriptPending} role="status" aria-live="polite">
        {streaming
          ? "Assembling your script…"
          : "Couldn't render the script this time. Ask for it again if you'd like."}
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script.better_approach);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard denied — leave the label alone; the text is
      // still selectable in the card body.
    }
  };

  return (
    <article className={styles.scriptCard}>
      <header className={styles.scriptHeader}>
        <div className={styles.scriptHeaderMain}>
          <p className={styles.scriptEyebrow}>Practice script</p>
          <h3 className={styles.scriptTitle}>{script.title}</h3>
          <span className={styles.scriptRule} aria-hidden="true" />
        </div>
        <button
          type="button"
          className={styles.copyButton}
          onClick={() => void copy()}
          aria-label="Copy the better approach"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </header>

      <div className={styles.scriptBody}>
        <section
          className={`${styles.scriptSection} ${styles.scriptSectionWrong}`}
          aria-label="How it goes wrong"
        >
          <p className={styles.scriptSectionLabel}>How it goes wrong</p>
          <ul className={styles.scriptExchange}>
            {script.unproductive_exchange.map((row, i) => (
              <li key={i} className={styles.scriptLine}>
                <span className={styles.scriptSpeaker}>{row.speaker}</span>
                <p className={styles.scriptQuote}>{row.line}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.scriptSection} aria-label="What went wrong">
          <p className={styles.scriptSectionLabel}>What went wrong</p>
          <ul className={styles.scriptList}>
            {script.what_went_wrong.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>

        <section
          className={`${styles.scriptSection} ${styles.scriptSectionBetter}`}
          aria-label="A better way in"
        >
          <p className={styles.scriptSectionLabel}>A better way in</p>
          <blockquote className={styles.scriptBetter}>
            {script.better_approach}
          </blockquote>
        </section>

        <section className={styles.scriptSection} aria-label="Why this works">
          <p className={styles.scriptSectionLabel}>Why this works</p>
          <p className={styles.scriptWhy}>{script.why_this_works}</p>
        </section>
      </div>
    </article>
  );
}
