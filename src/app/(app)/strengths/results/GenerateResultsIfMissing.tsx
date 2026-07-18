"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
    <section className="card stack-3">
      <div className="card-header">
        <h2>Tabulating your results</h2>
      </div>
      <div className="stack-3">
        <div
          className="progress-status"
          key={statusIndex}
          aria-live="polite"
        >
          {STATUS_MESSAGES[statusIndex]}
        </div>
        <div
          className="progress-indeterminate"
          role="progressbar"
          aria-label="Tabulating results"
        />
      </div>
      {error && <div className="field-error">{error}</div>}
    </section>
  );
}
