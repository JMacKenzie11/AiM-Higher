import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getDashboardData } from "@/lib/dashboard/service";
import { KeepRateBarChart } from "@/components/charts/KeepRateBarChart";
import { StatusChip } from "@/components/plan/StatusChip";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { CardAccent } from "@/components/ui/CardAccent";
import { BriefSection, BriefLoading } from "./BriefSection";
import { formatShortDate } from "@/lib/dates";
import styles from "./dashboard.module.css";

// Company Dashboard — Section 8.2.

export default async function DashboardPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const data = await getDashboardData(companyId);
  if (!data) redirect("/admin/companies");

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";

  return (
    <div className={styles.stage}>
      {/* ============ Hero band ============ */}
      <section className={styles.hero} aria-label="Company summary">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>
            {data.openQuarter ? (
              <>Current quarter · {data.openQuarter.label}</>
            ) : (
              <>
                No open quarter{" "}
                {isAdmin ? (
                  <Link href="/quarters" className={styles.eyebrowLink}>
                    · Open one
                  </Link>
                ) : null}
              </>
            )}
          </p>

          <h1 className={styles.h1}>{data.company.name}</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            How this quarter and this week are going.
          </p>

          <div className={styles.statRow}>
            <HeroStat
              label="Strategic Progress"
              value={
                data.headline.executionPercent === null ? (
                  "—"
                ) : (
                  <>
                    <AnimatedNumber value={data.headline.executionPercent} />%
                  </>
                )
              }
            />
            <HeroStat
              label="Follow-Through Rate"
              value={
                data.headline.keepRatePercent === null ? (
                  "—"
                ) : (
                  <>
                    <AnimatedNumber value={data.headline.keepRatePercent} />%
                  </>
                )
              }
            />
            <HeroStat
              label="On Track"
              value={
                data.headline.onTrack.total === 0 ? (
                  "—"
                ) : (
                  <>
                    <AnimatedNumber value={data.headline.onTrack.good} /> /{" "}
                    <AnimatedNumber value={data.headline.onTrack.total} />
                  </>
                )
              }
            />
            <HeroStat
              label="Open This Week"
              value={<AnimatedNumber value={data.headline.thisWeekOpen} />}
              caption={
                data.headline.thisWeekLinkedPercent === null ? undefined : (
                  <>
                    <AnimatedNumber
                      value={data.headline.thisWeekLinkedPercent}
                    />
                    % linked to plan
                  </>
                )
              }
            />
          </div>
        </div>
      </section>

      {/* ============ Content, overlapping the hero ============ */}
      <div className={styles.content}>
        {/* --- Week in review (admin-only, streamed via Suspense so
              the rest of the dashboard renders immediately while the
              model call is in flight) --- */}
        {isAdmin ? (
          <Suspense fallback={<BriefLoading />}>
            <BriefSection
              companyId={companyId}
              adminId={session.profile.id}
            />
          </Suspense>
        ) : null}

        {/* --- Recent successes (admin-only) --- */}
        {isAdmin && data.recentSuccesses.length > 0 ? (
          <section
            className={styles.cardAccent}
            aria-labelledby="successes-card"
          >
            <CardAccent />
            <h2 id="successes-card" className={styles.h2}>
              Recent wins
            </h2>
            <p className={styles.cardMeta}>
              The last {data.recentSuccesses.length} commitments closed on
              time this quarter.
            </p>
            <ul className={styles.successList}>
              {data.recentSuccesses.map((win) => (
                <li key={win.id} className={styles.successItem}>
                  <div className={styles.successHeader}>
                    <span className={styles.successOwner}>{win.ownerName}</span>
                    <span className={styles.successWhen}>
                      {win.completedAt
                        ? formatShortDate(win.completedAt.slice(0, 10))
                        : `Week ending ${formatShortDate(win.weekEnding)}`}
                    </span>
                  </div>
                  <p className={styles.successDescription}>{win.description}</p>
                  {win.priorityTitle ? (
                    <span className={styles.successPriorityMuted}>
                      Linked to: {win.priorityTitle}
                    </span>
                  ) : (
                    <span className={styles.successPriorityMuted}>
                      Operational
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* --- Strategic Focus Areas --- */}
        <section className={styles.cardAccent} aria-labelledby="sfa-card">
          <CardAccent />
          <h2 id="sfa-card" className={styles.h2}>
            Strategic Focus Areas
          </h2>
          {data.sfas.length === 0 ? (
            <p className={styles.emptyLine}>
              No focus areas yet.{" "}
              {isAdmin ? (
                <Link href="/plan" className={styles.inlineLink}>
                  Add the first one
                </Link>
              ) : null}
            </p>
          ) : (
            <ul className={styles.sfaList}>
              {data.sfas.map((sfa) => (
                <li key={sfa.id} className={styles.sfaRow}>
                  <Link
                    href={`/plan/sfa/${sfa.id}`}
                    className={styles.sfaLink}
                  >
                    <div className={styles.sfaLead}>
                      <h3 className={styles.sfaTitle}>{sfa.title}</h3>
                      <p className={styles.sfaSponsor}>
                        {sfa.sponsor?.full_name ?? "No sponsor yet"}
                      </p>
                    </div>
                    <StatusChip status={sfa.status} />
                    <div className={styles.sfaProgress}>
                      <ProgressBar
                        percent={sfa.percent}
                        label="No progress yet"
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data.orphanGoalCount > 0 ? (
            <p className={styles.orphanFootnote}>
              <Link href="/plan" className={styles.inlineLink}>
                {data.orphanGoalCount}{" "}
                {data.orphanGoalCount === 1 ? "goal" : "goals"} not yet linked
                to a focus area →
              </Link>
            </p>
          ) : null}
        </section>

        {/* --- Keep-rate trend --- */}
        <section className={styles.cardAccent} aria-labelledby="trend-card">
          <CardAccent />
          <h2 id="trend-card" className={styles.h2}>
            Follow-Through Rate Trend
          </h2>
          <p className={styles.cardMeta}>Last 12 weeks.</p>
          <KeepRateBarChart bars={data.keepRateTrend} />
        </section>

        {/* --- People --- */}
        <section className={styles.cardAccent} aria-labelledby="people-card">
          <CardAccent />
          <h2 id="people-card" className={styles.h2}>
            Where to lend support
          </h2>
          <p className={styles.cardMeta}>
            Sorted by follow-through rate. Reach out to whoever&rsquo;s at the top.
          </p>
          {data.people.length === 0 ? (
            <p className={styles.emptyLine}>
              No one on the roster yet.
            </p>
          ) : (
            <table className={styles.peopleTable}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Position</th>
                  <th className={styles.numHead}>Open</th>
                  <th>Follow-through rate</th>
                  {isAdmin ? <th aria-label="Coach" /> : null}
                </tr>
              </thead>
              <tbody>
                {data.people.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <Link
                        href={`/people/${person.id}`}
                        className={styles.personLink}
                      >
                        {person.full_name}
                      </Link>
                    </td>
                    <td className={styles.mutedCell}>{person.position ?? "—"}</td>
                    <td className={`${styles.numCell} aims-tabular`}>
                      {person.openCount}
                    </td>
                    <td className={styles.keepRateCell}>
                      <ProgressBar
                        percent={person.keepRate}
                        label="No resolved commitments"
                      />
                    </td>
                    {isAdmin ? (
                      <td>
                        <Link
                          href={`/coach/${person.id}`}
                          className={styles.coachButton}
                        >
                          Coach
                        </Link>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function HeroStat({
  label,
  value,
  caption,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
}) {
  return (
    <div className={styles.heroStat}>
      <span className={`${styles.heroStatValue} aims-tabular`}>{value}</span>
      <span className={styles.heroStatLabel}>{label}</span>
      {caption ? (
        <span className={styles.heroStatCaption}>{caption}</span>
      ) : null}
    </div>
  );
}
