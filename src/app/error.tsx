"use client";

import { useEffect } from "react";
import styles from "./boundary.module.css";

// Root error boundary. Rendered whenever any server component or client
// component throws. Non-blaming copy per Section 3; Try again resets
// the segment via `reset()` from Next.js.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // ASSUMPTION: server logs will already capture this via Vercel /
    // stdout; keeping a console line here for local dev visibility.
    console.error(error);
  }, [error]);

  return (
    <main className={styles.stage}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Something went sideways</p>
        <h1 className={styles.h1}>
          That page didn&rsquo;t load this time.
        </h1>
        <span className={styles.rule} aria-hidden="true" />
        <p className={styles.body}>
          Try again — most of the time it&rsquo;s a hiccup. If it keeps
          happening, your admin can check the logs.
        </p>
        {error.digest ? (
          <p className={styles.digest}>Reference: {error.digest}</p>
        ) : null}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => reset()}
          >
            Try again
          </button>
          <a href="/" className={styles.ghostLink}>
            Back to home
          </a>
        </div>
      </div>
    </main>
  );
}
