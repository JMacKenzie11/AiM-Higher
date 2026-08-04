import type {
  FacilitationDimension,
  FacilitationReview as FacilitationReviewData,
  FacilitationDimensionScore,
} from "@/lib/leadership/facilitation/types";
import styles from "./FacilitationReview.module.css";

// Panel that renders a structured facilitation review as a coaching
// artifact — strengths first, growth edges as opportunities (never
// red), forward-looking experiments, then the 4Ws audit as detail at
// the bottom. Called only when the feature is on AND the analysis has
// a facilitation_review_json (see meeting detail page).
//
// The visual language is intentionally warmer than a report: no
// red/green traffic lights, no "grade", no thumbs. The overall number
// is displayed as a "facilitation signal", not a score.

export function FacilitationReview({
  review,
}: {
  review: FacilitationReviewData;
}) {
  if (review.insufficient_transcript) {
    return (
      <section className={styles.card} aria-labelledby="facilitation">
        <Header review={review} />
        <p className={styles.insufficient}>
          {review.missing_context ??
            "The transcript was too sparse for a meaningful facilitation read this week."}
        </p>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="facilitation">
      <Header review={review} />

      {review.executive_summary ? (
        <p className={styles.summary}>{review.executive_summary}</p>
      ) : null}

      <SignalHeader review={review} />

      {review.strengths.length > 0 ? (
        <div className={styles.strengthsBlock}>
          <h3 className={styles.sectionHeading}>What worked</h3>
          <ul className={styles.strengthList}>
            {review.strengths.map((s, i) => (
              <li key={i} className={styles.strengthItem}>
                <span className={styles.strengthBadge} aria-hidden="true">
                  <svg viewBox="0 0 16 16" width={12} height={12}>
                    <path
                      d="M3.5 8.5 L6.5 11.5 L12.5 5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div>
                  <div className={styles.strengthTitle}>{s.title}</div>
                  {s.evidence ? (
                    <div className={styles.strengthEvidence}>{s.evidence}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.growth_edges.length > 0 ? (
        <div className={styles.growthBlock}>
          <h3 className={styles.sectionHeading}>Growth edges</h3>
          <div className={styles.growthGrid}>
            {(["rhythm", "accountability", "alignment"] as const).map((dim) => {
              const rows = review.growth_edges.filter(
                (g) => g.dimension === dim
              );
              if (rows.length === 0) return null;
              return (
                <div key={dim} className={styles.growthColumn}>
                  <div className={styles.growthDimLabel}>{labelFor(dim)}</div>
                  <ul className={styles.growthList}>
                    {rows.map((g, i) => (
                      <li key={i} className={styles.growthItem}>
                        <div className={styles.growthTitle}>{g.title}</div>
                        {g.evidence ? (
                          <div className={styles.growthEvidence}>
                            {g.evidence}
                          </div>
                        ) : null}
                        {g.why_it_matters ? (
                          <div className={styles.growthWhy}>
                            {g.why_it_matters}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {review.experiments.length > 0 ? (
        <div className={styles.experimentsBlock}>
          <h3 className={styles.sectionHeading}>What to try next week</h3>
          <ul className={styles.experimentList}>
            {review.experiments.map((e, i) => (
              <li key={i} className={styles.experimentItem}>
                <div className={styles.experimentAction}>{e.action}</div>
                {e.why ? (
                  <div className={styles.experimentWhy}>
                    <span className={styles.metaLabel}>Why:</span> {e.why}
                  </div>
                ) : null}
                {e.next_step ? (
                  <div className={styles.experimentNext}>
                    <span className={styles.metaLabel}>Try:</span> {e.next_step}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.fourws_audit.length > 0 ? (
        <div className={styles.audit}>
          <h3 className={styles.sectionHeading}>4Ws audit</h3>
          <p className={styles.auditCaption}>
            For each issue the meeting worked through, whether the four
            steps landed. A hollow circle means the flow didn't get there
            — it's an invitation, not a grade.
          </p>
          <div className={styles.auditTableWrap}>
            <table className={styles.auditTable}>
              <thead>
                <tr>
                  <th>Issue</th>
                  <th className={styles.auditColCentered}>What</th>
                  <th className={styles.auditColCentered}>Want</th>
                  <th className={styles.auditColCentered}>Way</th>
                  <th className={styles.auditColCentered}>Who/When</th>
                </tr>
              </thead>
              <tbody>
                {review.fourws_audit.map((row, i) => (
                  <tr key={i}>
                    <td>
                      <div className={styles.auditIssue}>{row.issue}</div>
                      {row.note ? (
                        <div className={styles.auditNote}>{row.note}</div>
                      ) : null}
                    </td>
                    <td className={styles.auditColCentered}>
                      <MarkGlyph hit={row.has_what} />
                    </td>
                    <td className={styles.auditColCentered}>
                      <MarkGlyph hit={row.has_want} />
                    </td>
                    <td className={styles.auditColCentered}>
                      <MarkGlyph hit={row.has_way} />
                    </td>
                    <td className={styles.auditColCentered}>
                      <MarkGlyph hit={row.has_who_when} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Header({ review }: { review: FacilitationReviewData }) {
  return (
    <div className={styles.header}>
      <h2 id="facilitation" className={styles.h2}>
        How the meeting was run
      </h2>
      <p className={styles.subhead}>
        A coaching-tone read of this meeting against the AiMS Weekly
        Leadership Meeting framework. Meant as a mirror, not a grade
        — cadence over any single week is what matters.
      </p>
      {!review.insufficient_transcript && review.overall !== null ? (
        <OverallSignal score={review.overall} />
      ) : null}
    </div>
  );
}

function OverallSignal({ score }: { score: number }) {
  const tone = signalTone(score);
  return (
    <div className={styles.overall} data-tone={tone}>
      <span className={styles.overallLabel}>Facilitation signal</span>
      <span className={styles.overallNumber}>{score}</span>
      <span className={styles.overallDenom}>/10</span>
    </div>
  );
}

function SignalHeader({ review }: { review: FacilitationReviewData }) {
  const items: Array<{
    key: string;
    label: string;
    score: number | null;
    denom: number;
    notes: string;
  }> = [
    {
      key: "agenda",
      label: "Agenda sections",
      score: review.agenda_adherence.score_out_of_5,
      denom: 5,
      notes: review.agenda_adherence.notes,
    },
    {
      key: "rhythm",
      label: "Rhythm",
      score: review.dimensions.rhythm.score,
      denom: 10,
      notes: review.dimensions.rhythm.notes,
    },
    {
      key: "accountability",
      label: "Accountability",
      score: review.dimensions.accountability.score,
      denom: 10,
      notes: review.dimensions.accountability.notes,
    },
    {
      key: "alignment",
      label: "Alignment",
      score: review.dimensions.alignment.score,
      denom: 10,
      notes: review.dimensions.alignment.notes,
    },
  ];
  return (
    <div className={styles.signals}>
      {items.map((item) => (
        <DimensionChip
          key={item.key}
          label={item.label}
          score={item.score}
          denom={item.denom}
          notes={item.notes}
        />
      ))}
    </div>
  );
}

function DimensionChip({
  label,
  score,
  denom,
  notes,
}: {
  label: string;
  score: number | null;
  denom: number;
  notes: string;
}) {
  const scaled =
    score == null ? null : Math.round((score / denom) * 10);
  const tone = scaled == null ? "neutral" : signalTone(scaled);
  return (
    <div className={styles.chip} data-tone={tone} title={notes || undefined}>
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipValue}>
        {score == null ? "—" : `${score}/${denom}`}
      </span>
    </div>
  );
}

function MarkGlyph({ hit }: { hit: boolean }) {
  if (hit) {
    return (
      <span className={styles.markHit} aria-label="landed">
        <svg viewBox="0 0 14 14" width={14} height={14}>
          <path
            d="M3 7.5 L6 10.5 L11 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className={styles.markMiss} aria-label="worth a beat next time">
      <svg viewBox="0 0 14 14" width={14} height={14}>
        <circle
          cx={7}
          cy={7}
          r={4.5}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        />
      </svg>
    </span>
  );
}

function labelFor(dim: FacilitationDimension): string {
  switch (dim) {
    case "rhythm":
      return "Rhythm";
    case "accountability":
      return "Accountability";
    case "alignment":
      return "Alignment";
  }
}

// Warm-forward tone scale: cobalt-tint on the low end, chartreuse-tint
// on the high end. Never red. See CSS module for the actual colours;
// the data-tone attribute keeps CSS in charge of the palette.
function signalTone(score: number): "low" | "mid" | "high" {
  if (score >= 8) return "high";
  if (score >= 5) return "mid";
  return "low";
}

// Small helper for the meeting list chip. Kept in this file so the
// tone scale and denominator lives in one place.
export function FacilitationListChip({
  review,
}: {
  review: FacilitationReviewData;
}) {
  if (review.insufficient_transcript || review.overall == null) {
    return null;
  }
  const tone = signalTone(review.overall);
  return (
    <span className={styles.listChip} data-tone={tone}>
      <span className={styles.listChipDot} aria-hidden="true" />
      Facilitation {review.overall}/10
    </span>
  );
}

// Type-only re-export so callers can lean on FacilitationDimensionScore
// without importing the underlying types file. Kept intentionally lean.
export type { FacilitationDimensionScore };
