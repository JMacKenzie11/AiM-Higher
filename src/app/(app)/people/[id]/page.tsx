import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getPersonScorecard } from "@/lib/people/service";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { KeepRateBarChart } from "@/components/charts/KeepRateBarChart";
import { CommitmentResolutionChip } from "@/components/plan/CommitmentResolutionChip";
import { formatShortDate } from "@/lib/dates";
import styles from "../people.module.css";

// Person Scorecard — Section 8.6.

type PageProps = { params: Promise<{ id: string }> };

export default async function PersonScorecardPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const data = await getPersonScorecard(id);
  if (!data) notFound();

  const isSelf = session.profile.id === id;
  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  const strengthsEnabled = data.profile.company_id
    ? await companyHasFeature(data.profile.company_id, "strengths")
    : false;

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Person summary">
        <div className={styles.heroInner}>
          <Link href="/people" className={styles.heroCrumb}>
            ← Back to people
          </Link>
          <h1 className={styles.h1}>{data.profile.full_name}</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            {data.profile.position ?? "Team member"} · {data.company.name}
          </p>
          <div className={styles.heroActions}>
            {isSelf ? (
              <Link href="/profile" className={styles.heroAction}>
                Edit my profile →
              </Link>
            ) : null}
            {isSelf ? (
              <Link href={`/coach/${id}`} className={styles.heroCoachAction}>
                Get coaching
              </Link>
            ) : null}
            {isAdmin && !isSelf ? (
              <Link
                href={`/coach/${id}`}
                className={styles.heroCoachAction}
              >
                Coach about {data.profile.full_name.split(" ")[0]}
              </Link>
            ) : null}
            {strengthsEnabled ? (
              <Link
                href={`/people/${id}/strengths`}
                className={styles.heroAction}
              >
                {isSelf
                  ? "View my strengths →"
                  : `View ${data.profile.full_name.split(" ")[0]}'s strengths →`}
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <div className={styles.content}>
        {/* ---- Scorecard ---- */}
        <section className={styles.card} aria-labelledby="scorecard">
          <h2 id="scorecard" className={styles.h2}>
            Scorecard
          </h2>
          <p className={styles.cardMeta}>Open quarter.</p>

          <div className={styles.personStatRow}>
            <PersonStat
              label="Follow-Through Rate"
              value={
                data.stats.keepRate === null
                  ? "—"
                  : `${data.stats.keepRate}%`
              }
            />
            <PersonStat label="Kept" value={String(data.stats.keptCount)} />
            <PersonStat label="Closed" value={String(data.stats.missedCount)} />
          </div>

          <div className={styles.trendWrap}>
            <p className={styles.cardMeta}>Last 12 weeks</p>
            <KeepRateBarChart
              bars={data.keepRateTrend}
              ariaLabel={`Follow-through rate by week for ${data.profile.full_name}`}
            />
          </div>
        </section>

        {/* ---- Open Commitments ---- */}
        <section className={styles.card} aria-labelledby="open">
          <h2 id="open" className={styles.h2}>
            Open commitments
          </h2>
          {data.openCommitments.length === 0 ? (
            <p className={styles.emptyLine}>
              No open commitments right now.
            </p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Priority</th>
                  <th>Due</th>
                  <th>Week</th>
                  <th>Flag</th>
                </tr>
              </thead>
              <tbody>
                {data.openCommitments.map((commitment) => {
                  const isPastDue = commitment.due_date < data.todayIso;
                  return (
                    <tr key={commitment.id}>
                      <td>{commitment.description}</td>
                      <td className={styles.mutedCell}>
                        {commitment.priority ? (
                          <Link
                            href={`/plan/priority/${commitment.priority.id}`}
                            className={styles.personLink}
                          >
                            {commitment.priority.title}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`${styles.mutedCell} aims-tabular`}>
                        {formatShortDate(commitment.due_date)}
                      </td>
                      <td className={`${styles.mutedCell} aims-tabular`}>
                        {formatShortDate(commitment.week_ending)}
                      </td>
                      <td>
                        {isPastDue ? (
                          <span className={styles.chipPastDue}>Past due</span>
                        ) : (
                          ""
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* ---- History ---- */}
        <section className={styles.card} aria-labelledby="history">
          <h2 id="history" className={styles.h2}>
            History
          </h2>
          {data.history.length === 0 ? (
            <p className={styles.emptyLine}>
              Nothing resolved yet.
            </p>
          ) : (
            data.history.map((group) => (
              <div key={group.weekEnding} className={styles.historyGroup}>
                <div className={styles.weekLabel}>
                  Week ending {formatShortDate(group.weekEnding)}
                </div>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Priority</th>
                      <th>Due</th>
                      <th>Resolution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.commitments.map((commitment) => (
                      <tr key={commitment.id}>
                        <td>
                          {commitment.description}
                          {commitment.missed_reason ? (
                            <p className={styles.reasonNote}>
                              Reason: {commitment.missed_reason}
                            </p>
                          ) : null}
                        </td>
                        <td className={styles.mutedCell}>
                          {commitment.priority ? (
                            <Link
                              href={`/plan/priority/${commitment.priority.id}`}
                              className={styles.personLink}
                            >
                              {commitment.priority.title}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={`${styles.mutedCell} aims-tabular`}>
                          {formatShortDate(commitment.due_date)}
                        </td>
                        <td>
                          <CommitmentResolutionChip commitment={commitment} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function PersonStat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.personStat}>
      <span className={`${styles.personStatValue} aims-tabular`}>{value}</span>
      <span className={styles.personStatLabel}>{label}</span>
    </div>
  );
}
