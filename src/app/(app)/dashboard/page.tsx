import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard/service";
import { getMeasureInsights } from "@/lib/measures/insights";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { KeepRateBarChart } from "@/components/charts/KeepRateBarChart";
import { StatusChip } from "@/components/plan/StatusChip";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { CardAccent } from "@/components/ui/CardAccent";
import { BriefSection, BriefLoading } from "./BriefSection";
import { HeroStat } from "./HeroStat";
import { MeasureInsightsCards } from "./MeasureInsightsCards";
import { getBoardData } from "@/lib/measures/board";
import { BoardView } from "../measures/board/BoardView";
import { PageShell } from "@/components/ui/PageShell";
import { formatShortDate } from "@/lib/dates";
import styles from "./dashboard.module.css";

// Company Dashboard — Section 8.2.

export default async function DashboardPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  // Cross-tenant roles land on Guide HQ as their default home base
  // (own commitments across companies, attention queue, caseload).
  // Company admins / team members still fall through to the company
  // picker at /admin/companies, though in practice a company_admin
  // always has a company_id so companyId shouldn't be null for them.
  const crossTenantHome =
    session.profile.role === "system_admin" ||
    session.profile.role === "aims_guide"
      ? "/hq"
      : "/admin/companies";
  if (!companyId) redirect(crossTenantHome);

  const data = await getDashboardData(companyId);
  if (!data) redirect(crossTenantHome);

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  // Whether the caller has admin-level authority over *this* company.
  // Broader than the local isAdmin above because it also admits an
  // aims_guide when the current company is one of their assignments.
  const canManageCompany = isAdminForCompany(session.profile, companyId);

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
  const measureInsights = await getMeasureInsights(
    companyId,
    data.company.timezone
  );

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
  const board = await getBoardData(companyId, data.company.timezone);
  // Managers get the Coach column for rows they own via
  // profiles.reports_to — same rule as the coaching_conversations
  // insert policy in migration 0021. If they don't manage anyone on
  // the roster there's no point showing the column at all.
  const managesAnyone = data.people.some(
    (p) => p.reports_to === session.profile.id,
  );
  const showCoachColumn = isAdmin || managesAnyone;

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
  const settingsHref = `/admin/companies/${companyId}`;

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
    <PageShell
      eyebrow={eyebrow}
      title={data.company.name}
      subtitle="How this quarter and this week are going."
      ariaLabel="Company summary"
      heroExtras={
        <>
          {/* Primary stat: Follow-Through Rate. Weekly meetings
              open on this number, so it gets a full-width row of
              its own with a larger value font. Everything else
              lives in the secondary strip below. */}
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
            <HeroStat
              label="Commitment Clarity"
              caption="Timeline + success defined"
              tooltip={
                data.headline.clarityAssessedCount === 0
                  ? "Once commitments are assessed against the two clarity criteria (timeline, definition of done), this shows the share that meet both."
                  : `Of ${data.headline.clarityAssessedCount} assessed commitment${data.headline.clarityAssessedCount === 1 ? "" : "s"} this quarter, the share that meet both clarity criteria (timeline, definition of done).`
              }
              value={
                data.headline.clarityPercent === null ? (
                  "—"
                ) : (
                  <>
                    <AnimatedNumber value={data.headline.clarityPercent} />%
                  </>
                )
              }
            />
          </div>
        </>
      }
    >
      {/* Setup checklist moved to /scorecard (AiMS Implementation
          surface) — see src/components/setup/SetupChecklist. This
          dashboard is for the running rhythm; the setup scaffold
          belongs on the discipline-progression page where
          first-run admins go to see how the practice is landing. */}

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

        {/* Directly under the brief, which is where it was asked
            for: the brief says what happened this week, and this says
            what the last thirteen look like. */}
        {board && board.hasEntries ? <BoardView data={board} /> : null}

        {measureInsights ? (
          <MeasureInsightsCards insights={measureInsights} />
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

        {/* --- Focus Areas --- */}
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
                  <th className={styles.numHead}>Kept</th>
                  <th
                    className={styles.numHead}
                    title="Completed after the due date — same 'did the work' signal, but not counted in Follow-Through Rate"
                  >
                    Late
                  </th>
                  <th className={styles.numHead}>Missed</th>
                  <th>Follow-Through Rate</th>
                  {showCoachColumn ? <th aria-label="Coach" /> : null}
                </tr>
              </thead>
              <tbody>
                {data.people.map((person) => {
                  const canCoachPerson =
                    isAdmin || person.reports_to === session.profile.id;
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
                    <td className={`${styles.numCell} aims-tabular`}>
                      {person.missedCount}
                    </td>
                    <td className={styles.keepRateCell}>
                      <ProgressBar
                        percent={person.keepRate}
                        label="No resolved commitments"
                      />
                    </td>
                    {showCoachColumn ? (
                      <td>
                        {canCoachPerson ? (
                          <Link
                            href={`/coach/${person.id}`}
                            className={styles.coachButton}
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
    </PageShell>
  );
}

