import Link from "next/link";
import type { SessionProfile } from "@/lib/auth/current-user";
import { canCoachAbout, isAdminForCompany } from "@/lib/auth/permissions";
import { getDashboardData } from "@/lib/dashboard/service";
import { getMeasureInsights } from "@/lib/measures/insights";
import { KeepRateBarChart } from "@/components/charts/KeepRateBarChart";
import { StatusChip } from "@/components/plan/StatusChip";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { CardAccent } from "@/components/ui/CardAccent";
import { HeroStat } from "./HeroStat";
import { MeasureInsightsCards } from "./MeasureInsightsCards";
import { getBoardData } from "@/lib/measures/board";
import { BoardView } from "../measures/board/BoardView";
import { formatShortDate, formatWeekBeginning } from "@/lib/dates";
import styles from "./dashboard.module.css";
import { simplifyOn } from "@/lib/ui/simplify";

// The Dashboard tab: Company Dashboard, Section 8.2. What was the whole
// /dashboard page until the This week tab joined it (Jason, 2026-11-21).
// Its headline numbers sit in a navy tile at the top; Commitment Clarity
// is no longer one of them. The week in review moved to This week.

type DashboardData = NonNullable<Awaited<ReturnType<typeof getDashboardData>>>;

export async function CompanyDashboard({
  profile,
  companyId,
  data,
}: {
  profile: SessionProfile;
  companyId: string;
  data: DashboardData;
}) {
  // Whether the caller has admin-level authority over *this* company:
  // its company_admin, an assigned guide, a portfolio admin switched on
  // as its admin (Jason, 2026-11-09).
  const canManageCompany = isAdminForCompany(profile, companyId);
  const isAdmin = canManageCompany;

  // Setup checklist moved to /scorecard (the AiMS Implementation
  // surface). The dashboard is the running-rhythm view; the
  // first-run scaffold now lives on the discipline-progression
  // page where new admins go to see how the practice is landing.
  // See src/lib/dashboard/setup-steps.ts +
  // src/components/setup/SetupChecklist.tsx.

  // Generative "gaining ground / streaks / wins / worth a
  // conversation" cards for the whole company. The cards render
  // nothing when there's no data, which is the only gate they need:
  // these read numbers people have already recorded, and Success
  // Tracking is about what the Saturday sweep does, not about who
  // may look at their own values.
  //
  // Read TOGETHER with the board below. Neither needs the other, each
  // is three reads deep, and they used to run back to back.
  const [measureInsights, board] = await Promise.all([
    getMeasureInsights(companyId, data.company.timezone),
    getBoardData(companyId, data.company.timezone),
  ]);

  // The 13-week board, which used to sit on /measures.
  //
  // It moved here because that is where it was looked for. On
  // /measures it sat above the value inputs — the thing people open
  // that page to use every week — so it was collapsed to stay out of
  // the way, and collapsed at the top of a page people scroll past is
  // indistinguishable from absent. The dashboard is the standing
  // "how are we doing" surface, which is the question this answers.
  //
  // Rendered only when some value has actually been recorded: see
  // hasEntries in board.ts. A frame of empty weeks teaches nobody
  // anything. One real point is sparse and true, and shows. That is
  // the whole gate now — it used to also require Success Tracking,
  // which hid a company's own recorded numbers from it.
  // (Read above, alongside the insights.)
  // Coach: anyone in the company, about anyone else in it, or an
  // admin for it (canCoachAbout; 0261). The column shows when at least
  // one row has the button.
  const canCoachPerson = (personId: string) =>
    canCoachAbout(profile, { id: personId, company_id: companyId });
  const showCoachColumn = data.people.some((p) => canCoachPerson(p.id));
  // Nothing marks a commitment missed (Jason, 2026-10-16), so the
  // column is always 0; the "quiet-rows" switch takes it out.
  const showMissed = !simplifyOn("quiet-rows");
  // A shorter Week in Review (simplification review, change 9): the
  // brief, the numbers board and who needs support. Recent wins open
  // the meeting's check-in, Focus Areas live on Goals & Priorities, and
  // the follow-through rate is the number at the top.
  const shortReview = simplifyOn("short-review");

  // A LAPSED quarter has to say so. It used to read "Current quarter
  // · Q3 2026" with no link, because the link only appeared when
  // there was NO open quarter — and a quarter whose end date passed
  // in September is still open. So the one line an admin would glance
  // at showed a company as healthy for as long as nobody rolled it.
  //
  // Nothing breaks any more when a quarter lapses, which is the point
  // of this change. But the priorities inside it stop matching the
  // period the team is actually working, and that is worth a word.
  const today = new Date().toISOString().slice(0, 10);
  const quarterLapsed =
    data.openQuarter !== null && data.openQuarter.end_date < today;
  // Straight to the Planning tab, where the Quarter card is. Everyone
  // canManageCompany admits sees that card (isAdminForCompany).
  const settingsHref = `/admin/companies/${companyId}#planning`;

  const eyebrow = data.openQuarter ? (
    quarterLapsed ? (
      <>
        {data.openQuarter.label} ended {formatShortDate(data.openQuarter.end_date)}{" "}
        {canManageCompany ? (
          <Link href={settingsHref} className={styles.eyebrowLink}>
            · Roll the quarter
          </Link>
        ) : null}
      </>
    ) : (
      <>Current quarter · {data.openQuarter.label}</>
    )
  ) : (
    <>
      No open quarter{" "}
      {canManageCompany ? (
        <Link href={settingsHref} className={styles.eyebrowLink}>
          · Open one
        </Link>
      ) : null}
    </>
  );

  return (
    <>
      <section className={styles.statsTile} aria-label="Company summary">
        <p className={styles.statsEyebrow}>{eyebrow}</p>
            <div className={styles.statPrimary}>
              <HeroStat
                label="Follow-Through Rate"
                caption="Resolved on time this quarter"
                tooltip="Of all commitments resolved this quarter, the share that closed on time. Both strategic and operational commitments count."
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
            </div>

            <div className={styles.statRow}>
              <HeroStat
                label="Strategic Progress"
                caption="Focus Areas this quarter"
                tooltip="Average progress across your Focus Areas this quarter. Rolls up from priority-level progress and reflects only strategic commitments — operational (unlinked) commitments don't count here."
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
                label="On Track"
                caption="Priorities pacing to hit target"
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
                caption="Commitments due by Friday"
                value={<AnimatedNumber value={data.headline.thisWeekOpen} />}
              />
            </div>
      </section>

        {/* The last thirteen weeks, first under the numbers. */}
        {board && board.hasEntries ? <BoardView data={board} /> : null}

        {measureInsights ? (
          <MeasureInsightsCards insights={measureInsights} />
        ) : null}

        {/* --- Recent successes, for everyone in the company (0253) --- */}
        {!shortReview && data.recentSuccesses.length > 0 ? (
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
                        : `Week beginning ${formatWeekBeginning(win.weekEnding)}`}
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

        {/* --- Focus Areas (on Goals & Priorities under short-review) --- */}
        {shortReview ? null : (
        <section className={styles.cardAccent} aria-labelledby="sfa-card">
          <CardAccent />
          <h2 id="sfa-card" className={styles.h2}>
            Focus Areas
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
        )}

        {/* --- Keep-rate trend (the hero carries the rate under short-review) --- */}
        {shortReview ? null : (
        <section className={styles.cardAccent} aria-labelledby="trend-card">
          <CardAccent />
          <h2 id="trend-card" className={styles.h2}>
            Follow-Through Rate Trend
          </h2>
          <p className={styles.cardMeta}>Last 12 weeks.</p>
          <KeepRateBarChart bars={data.keepRateTrend} />
        </section>
        )}

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
                  <th className={styles.numHead}>Kept</th>
                  <th
                    className={styles.numHead}
                    title="Completed after the due date — same 'did the work' signal, but not counted in Follow-Through Rate"
                  >
                    Late
                  </th>
                  {showMissed ? <th className={styles.numHead}>Missed</th> : null}
                  <th>Follow-Through Rate</th>
                  {showCoachColumn ? <th aria-label="Coach" /> : null}
                </tr>
              </thead>
              <tbody>
                {data.people.map((person) => {
                  return (
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
                    <td className={`${styles.numCell} aims-tabular`}>
                      {person.keptOnTimeCount}
                    </td>
                    <td className={`${styles.numCell} aims-tabular`}>
                      {person.keptLateCount}
                    </td>
                    {showMissed ? (
                      <td className={`${styles.numCell} aims-tabular`}>
                        {person.missedCount}
                      </td>
                    ) : null}
                    <td className={styles.keepRateCell}>
                      <ProgressBar
                        percent={person.keepRate}
                        label="No resolved commitments"
                      />
                    </td>
                    {showCoachColumn ? (
                      <td>
                        {canCoachPerson(person.id) ? (
                          <Link
                            href={`/coach/${person.id}`}
                            className={`${styles.coachButton}`}
                          >
                            Coach
                          </Link>
                        ) : null}
                      </td>
                    ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
    </>
  );
}
