import { CompanyNameLink } from "../admin/companies/CompanyNameLink";
import type { PortfolioCard } from "@/lib/portfolio/service";
import styles from "./portfolio.module.css";

// One company, three numbers, one link.
//
// THE LINK IS THE ONLY AFFORDANCE. Scope in, and that is all. Guide HQ
// offers "Prepare for <company>" beside each row because a guide is
// about to coach them; a portfolio admin is not, so there is nothing
// here but the way in. Adding a second control would be the first step
// toward this becoming a second Guide HQ.

function scoreLine(card: PortfolioCard): string {
  return card.scorecardOverall === null ? "—" : `${card.scorecardOverall}/10`;
}

export function PortfolioCompanyCard({ card }: { card: PortfolioCard }) {
  const weekLabel =
    card.week.rate === null
      ? "—"
      : `${card.week.rate}%`;

  return (
    <li className={styles.companyCard}>
      <h3 className={styles.companyName}>
        <CompanyNameLink companyId={card.id} name={card.name} />
      </h3>

      <dl className={styles.metrics}>
        <dt className={styles.metricLabel}>Scorecard</dt>
        <dd className={styles.metricValue}>
          {scoreLine(card)}
          {/* The denominator travels with the number. An overall is a
              weighted mean over whichever disciplines scored, so two
              companies' overalls are not comparable unless they cover
              the same set — and a grid of cards is an invitation to
              compare them. See compareOverall in lib/maturity. */}
          {card.scorecardOverall === null ? null : (
            <span className={styles.metricQualifier}>
              across {card.scorecardDisciplines}{" "}
              {card.scorecardDisciplines === 1 ? "discipline" : "disciplines"}
            </span>
          )}
        </dd>

        <dt className={styles.metricLabel}>
          Priorities
          {card.quarterLabel ? (
            <span className={styles.metricQualifier}>{card.quarterLabel}</span>
          ) : null}
        </dt>
        <dd className={styles.metricValue}>
          {/* Null and zero are different answers and render
              differently: no quarter open, or no priorities in it, is
              a dash; nothing on track is 0%. */}
          {card.priorityPercent === null ? (
            "—"
          ) : (
            <>
              {card.priorityPercent}%
              <span className={styles.metricQualifier}>
                {card.priorityGood} of {card.priorityTotal} on track
              </span>
            </>
          )}
        </dd>

        <dt className={styles.metricLabel}>
          This week
          <span className={styles.metricQualifier}>
            week ending {card.weekEnding}
          </span>
        </dt>
        <dd className={styles.metricValue}>
          {weekLabel}
          {card.week.rate === null ? null : (
            <span className={styles.metricQualifier}>
              {card.week.keptOnTime} of {card.week.resolved} kept on time
            </span>
          )}
        </dd>
      </dl>
    </li>
  );
}
