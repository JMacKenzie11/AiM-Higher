import { CompanyNameLink } from "../admin/companies/CompanyNameLink";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { formatShortDate } from "@/lib/dates";
import type { PortfolioCard } from "@/lib/portfolio/service";
import styles from "./portfolio.module.css";

// One company, three numbers, one link.
//
// THE LINK IS THE ONLY AFFORDANCE. Scope in, and that is all. Guide HQ
// offers "Prepare for <company>" beside each row because a guide is
// about to coach them; a portfolio admin is not, so there is nothing
// here but the way in.
//
// ---- Shape ---------------------------------------------------
//
// Built from the vocabulary the rest of the app already uses rather
// than invented for this page: the tracked uppercase metric label
// from the dashboard hero stats, the cobalt-on-navy-tint ProgressBar
// from the plan cascade, tabular numerals, and the sand/navy palette.
//
// The scorecard is the visual anchor — one large number per card, so
// a grid of these can be scanned down the same column. The two
// percentages get bars instead of a second and third large number,
// because three competing figures per card is a table with extra
// steps, and because a bar answers "how far along" faster than a
// figure does.
//
// Every qualifier sits on its OWN full-width line. The first version
// put them in the label column, where "week ending 2026-09-18" wrapped
// to two lines and collided with the value beside it.

function scoreValue(card: PortfolioCard): { whole: string; suffix: string } {
  if (card.scorecardOverall === null) return { whole: "—", suffix: "" };
  return { whole: String(card.scorecardOverall), suffix: "/10" };
}

export function PortfolioCompanyCard({ card }: { card: PortfolioCard }) {
  const score = scoreValue(card);

  return (
    <li className={styles.companyCard}>
      <h3 className={styles.companyName}>
        <CompanyNameLink companyId={card.id} name={card.name} />
      </h3>

      {/* Scorecard — the anchor stat. */}
      <div className={styles.metric}>
        <p className={styles.metricLabel}>Scorecard</p>
        <p className={styles.metricStat}>
          <span className="aims-tabular">{score.whole}</span>
          {score.suffix ? (
            <span className={styles.metricStatSuffix}>{score.suffix}</span>
          ) : null}
        </p>
        <p className={styles.metricNote}>
          {/* The denominator travels with the number. An overall is a
              weighted mean over whichever disciplines scored, so two
              companies' overalls are not comparable unless they cover
              the same set — and a grid of cards is an invitation to
              compare them. See compareOverall in lib/maturity. */}
          {card.scorecardOverall === null
            ? "no score yet"
            : `across ${card.scorecardDisciplines} ${
                card.scorecardDisciplines === 1 ? "discipline" : "disciplines"
              }`}
        </p>
      </div>

      {/* Priorities — this quarter. */}
      <div className={styles.metric}>
        <p className={styles.metricLabel}>
          Priorities
          {card.quarterLabel ? (
            <span className={styles.metricLabelTag}>{card.quarterLabel}</span>
          ) : null}
        </p>
        <ProgressBar
          percent={card.priorityPercent}
          label={`Priorities on track for ${card.name}`}
        />
        <p className={styles.metricNote}>
          {/* Null and zero are different answers. No quarter open, or
              no priorities in it, is not the same as none on track. */}
          {card.priorityPercent === null
            ? card.quarterLabel
              ? "no priorities set yet"
              : "no open quarter"
            : `${card.priorityGood} of ${card.priorityTotal} on track`}
        </p>
      </div>

      {/* This week — commitments, in the company's own clock. */}
      <div className={styles.metric}>
        <p className={styles.metricLabel}>
          This week
          <span className={styles.metricLabelTag}>
            to {formatShortDate(card.weekEnding)}
          </span>
        </p>
        <ProgressBar
          percent={card.week.rate}
          label={`Commitments kept on time for ${card.name}`}
        />
        <p className={styles.metricNote}>
          {card.week.rate === null
            ? "nothing due this week"
            : `${card.week.keptOnTime} of ${card.week.resolved} kept on time`}
        </p>
      </div>
    </li>
  );
}
