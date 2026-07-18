"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/app/(app)/strengths/strengths.module.css";

const STATUS_MESSAGES = [
  "Reading your responses",
  "Scoring the four dimensions",
  "Mapping the sixteen sub-strengths",
  "Reading your story alongside the scores",
  "Naming what your energy is telling us",
  "Drafting your read",
  "Finalizing",
];

export default function GenerateResultsIfMissing({
  assessmentId,
}: {
  assessmentId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStatusIndex((i) => Math.min(i + 1, STATUS_MESSAGES.length - 1));
    }, 2200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/strengths/generate-results", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assessment_id: assessmentId }),
        });
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Something went wrong.");
          return;
        }
        router.refresh();
      } catch {
        if (!cancelled) setError("Couldn't reach the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assessmentId, router]);

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Tabulating results">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Strengths results</p>
          <h1 className={styles.h1}>Tabulating your results</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle} aria-live="polite">
            {STATUS_MESSAGES[statusIndex]}…
          </p>
        </div>
      </section>
      <div className={`${styles.content} ${styles.contentProse}`}>
        <section className={styles.card}>
          <div className={styles.barTrack} role="progressbar" aria-label="Tabulating results">
            <div
              className={`${styles.barFill} ${styles.barCompetence}`}
              style={{ width: "100%", opacity: 0.6 }}
            />
          </div>
          {error ? <p className={styles.fieldError}>{error}</p> : null}
        </section>
      </div>
    </div>
  );
}
