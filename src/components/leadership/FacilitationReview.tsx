import type {
  FacilitationDimension,
  FacilitationReview as FacilitationReviewData,
  FacilitationDimensionScore,
} from "@/lib/leadership/facilitation/types";
import { PartInfo } from "./PartInfo";
import {
  SCORE_PART_DESCRIPTIONS,
  scoreForRow,
  type MeetingScore,
  type OverallScore,
  type StoredScoreRow,
} from "@/lib/leadership/facilitation/score";
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
  score,
}: {
  review: FacilitationReviewData;
  // scoreForRow: computed from the five parts for meetings analysed
  // since the cutover, the original score for everything older.
  score: MeetingScore | null;
}) {
  if (review.insufficient_transcript) {
    return (
      <section className={styles.card} aria-labelledby="facilitation">
        <Header />
        <p className={styles.insufficient}>
          {review.missing_context ??
            "The transcript was too sparse for a meaningful facilitation read this week."}
        </p>
      </section>
    );
  }

  const nextWeek = review.next_week_questions ?? [];
  // Only the current shape: rows from before the change hold a quoted
  // `question`, which is exactly what this block no longer shows.
  const opened = (review.opening_questions ?? []).filter(
    (q): q is { asker: string; asked: string; opened: string } =>
      typeof q.asked === "string" && typeof q.opened === "string"
  );

  return (
    <section className={styles.card} aria-labelledby="facilitation">
      <Header />

      {score?.kind === "computed" ? <ScoreExplainer score={score.score} /> : null}
      {review.score_withheld ? (
        <p className={styles.scoreNote}>
          No score for this meeting. The review left out part of what the
          score is built from, so only the notes are shown.
        </p>
      ) : null}
      {score?.kind === "original" ? (
        <p className={styles.scoreNote}>
          Scored before the current method, so there is no breakdown for
          this meeting.
        </p>
      ) : null}

      {review.executive_summary ? (
        <p className={styles.summary}>{review.executive_summary}</p>
      ) : null}

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

      {nextWeek.length > 0 ? (
        <div className={styles.questionsBlock}>
          <h3 className={styles.sectionHeading}>Questions worth asking next week</h3>
          <ul className={styles.questionList}>
            {nextWeek.map((q, i) => (
              <li key={i} className={styles.questionItem}>
                <div className={styles.questionText}>{q.question}</div>
                {q.moment ? (
                  <div className={styles.questionMoment}>From: {q.moment}</div>
                ) : null}
              </li>
            ))}
          </ul>
          <p className={styles.questionsHelp}>
            A generative question starts from something that went well and
            asks where it could go next. A diagnostic question starts from a
            problem and asks what caused it. These three are the first kind.
          </p>
        </div>
      ) : null}

      {opened.length > 0 ? (
        <div className={styles.questionsBlock}>
          <h3 className={styles.sectionHeading}>Questions that opened things up</h3>
          <ul className={styles.questionList}>
            {opened.map((q, i) => (
              <li key={i} className={styles.askedItem}>
                <div className={styles.askedQuestion}>
                  {q.asker} asked {q.asked}.
                </div>
                <div className={styles.askedBy}>{q.opened}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.fourws_audit.length > 0 ? (
        <div className={styles.audit}>
          <h3 className={styles.sectionHeading}>4Ws audit</h3>
          <p className={styles.auditCaption}>
            For each issue the meeting worked through, which of the four steps
            it reached. Where a circle is hollow, the note under the issue is
            a question to ask next time.
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

// The number on the panel and the strip: rounded either way.
export function displayScore(score: MeetingScore): number {
  return score.kind === "computed" ? score.score.rounded : Math.round(score.value);
}

// No score here: it is on the strip above the tabs, once, in this
// panel's old "Facilitation signal" style. Jason, 2026-09-25: it was
// in both places.
function Header() {
  return (
    <div className={styles.header}>
      <h2 id="facilitation" className={styles.h2}>
        How the meeting was run
      </h2>
    </div>
  );
}

// "How this is scored": the four parts, their weights, and this
// meeting's arithmetic, so the number is never a black box.
function ScoreExplainer({ score }: { score: OverallScore }) {
  const decimal = (n: number) => (n / 100).toFixed(2);
  const arithmetic = score.lines
    .map((l) => `(${l.scaled} \u00d7 ${decimal(l.weight)})`)
    .join(" + ");
  return (
    <details className={styles.scoreDetails}>
      <summary>How this is scored</summary>
      <div className={styles.scoreTableWrap}>
        <table className={styles.scoreTable}>
          <thead>
            <tr>
              <th>Part</th>
              <th>Score</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {score.lines.map((l) => (
              <tr key={l.key}>
                <td>
                  {l.label}
                  <PartInfo label={l.label} text={SCORE_PART_DESCRIPTIONS[l.key]} />
                </td>
                <td>
                  {l.raw}/{l.outOf}
                  {l.outOf === 5 ? ` (${l.scaled}/10)` : ""}
                </td>
                <td>{l.weight}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.scoreArithmetic}>
        {arithmetic} = <strong>{score.oneDecimal}</strong>, shown as{" "}
        {score.rounded}.
      </p>
      <p className={styles.scoreNote}>
        Agenda sections is scored out of 5 and doubled to put it on the same
        scale as the others.
      </p>
    </details>
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
    case "positive_framing":
      return "Appreciative practice";
  }
}

// Warm-forward tone scale: cobalt-tint on the low end, chartreuse-tint
// on the high end. Never red. See CSS module for the actual colours;
// the data-tone attribute keeps CSS in charge of the palette.
export function signalTone(score: number): "low" | "mid" | "high" {
  if (score >= 8) return "high";
  if (score >= 5) return "mid";
  return "low";
}

// Small helper for the meeting list chip. Kept in this file so the
// tone scale and denominator lives in one place.
//
// Three states, in order of specificity:
//   - Insufficient transcript: the review ran and honestly reported
//     the meeting wasn't scoreable. Muted chip so it's visible on the
//     list as "yes reviewed, no grade" instead of looking identical
//     to "never reviewed."
//   - Overall null (no dimensions either): treat as "no review yet"
//     and render nothing. Rare — the normalizer now falls back to a
//     dimension-mean when dimensions ARE present, so this only fires
//     when the model gave up entirely.
//   - Real overall score: coloured chip with the number.
export function FacilitationListChip({
  review,
  row,
}: {
  review: FacilitationReviewData;
  row?: StoredScoreRow | null;
}) {
  if (review.insufficient_transcript) {
    return (
      <span
        className={styles.listChip}
        data-tone="low"
        title="Facilitation review ran but the transcript wasn't a scoreable weekly leadership meeting"
      >
        <span className={styles.listChipDot} aria-hidden="true" />
        Insufficient
      </span>
    );
  }
  // The same number the meeting page shows: computed from the parts,
  // from the row's stored parts when it has them.
  const score = scoreForRow(row ?? null, review);
  const overall = score ? displayScore(score) : null;
  if (overall == null) return null;
  const tone = signalTone(overall);
  return (
    <span className={styles.listChip} data-tone={tone}>
      <span className={styles.listChipDot} aria-hidden="true" />
      Facilitation {overall}/10
    </span>
  );
}

// Type-only re-export so callers can lean on FacilitationDimensionScore
// without importing the underlying types file. Kept intentionally lean.
export type { FacilitationDimensionScore };
