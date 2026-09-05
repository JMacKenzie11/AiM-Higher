"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import styles from "./boundary.module.css";

// Root error boundary. Rendered whenever any server component or client
// component throws. Non-blaming copy per Section 3; Try again resets
// the segment via `reset()` from Next.js.
//
// Must call Sentry.captureException so intermittent errors surface —
// otherwise the boundary catches them silently and the only evidence
// is the digest on the screen. global-error.tsx already does this for
// the root-layout crash case; this covers everything below.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
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
          {/* Try again does a hard reload, not reset(). Reload is a
              superset — it works both for transient errors AND for
              the stale-server-action-id case after a fresh deploy.
              reset() alone can't recover from the latter because it
              reruns the same segment with the same cached IDs. Two
              buttons read as two things to a user; one that always
              works is the better UX. */}
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              // reset() first to give the segment a chance to
              // re-render (kept for parity with Next.js patterns),
              // then a full reload as the belt-and-braces recovery.
              reset();
              window.location.reload();
            }}
          >
            Try again
          </button>
          {/* A real anchor, not next/link, and deliberately so: a
              client-side navigation would re-render into the same
              broken React tree this boundary just caught. A full
              document load is the recovery, same reasoning as the
              window.location.reload() above. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className={styles.ghostLink}>
            Back to home
          </a>
        </div>
      </div>
    </main>
  );
}
