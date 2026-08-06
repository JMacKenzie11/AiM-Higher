import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard/service";
import { getMeasureInsights } from "@/lib/measures/insights";
import { getMeasuresOwnedBy } from "@/lib/measures/service";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { KeepRateBarChart } from "@/components/charts/KeepRateBarChart";
import { StatusChip } from "@/components/plan/StatusChip";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { CardAccent } from "@/components/ui/CardAccent";
import { BriefSection, BriefLoading } from "./BriefSection";
import { HeroStat } from "./HeroStat";
import { MeasureInsightsCards } from "./MeasureInsightsCards";
import { PendingMeasuresCard } from "./PendingMeasuresCard";
import { SetupChecklist, type SetupStep } from "./SetupChecklist";
import { formatShortDate } from "@/lib/dates";
import styles from "./dashboard.module.css";

// Company Dashboard — Section 8.2.

export default async function DashboardPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const data = await getDashboardData(companyId);
  if (!data) redirect("/admin/companies");

  // Pending-measures widget only renders when performance_tracking
  // is on for this company and the caller actually owns some
  // measures that don't have a value for the current week yet.
  const perfTrackingOn = await companyHasFeature(
    companyId,
    "performance_tracking"
  );
  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  // Whether the caller has admin-level authority over *this* company.
  // Broader than the local isAdmin above because it also admits an
  // aims_guide when the current company is one of their assignments.
  const canManageCompany = isAdminForCompany(session.profile, companyId);

  // First-run setup checklist — rendered when the caller can manage
  // this company (sysadmin, company admin scoped here, or assigned
  // guide) AND at least one setup step is incomplete. Cheap read: one
  // extra query for the foundation row; everything else is already
  // loaded.
  let setupSteps: SetupStep[] | null = null;
  if (canManageCompany) {
    const supabase = await createSupabaseServerClient();
    const { data: foundationRow } = await supabase
      .from("company_foundation")
      .select("purpose_statement, vision")
      .eq("company_id", companyId)
      .maybeSingle<{ purpose_statement: string | null; vision: string | null }>();
    const hasFoundation = Boolean(
      foundationRow?.purpose_statement?.trim() || foundationRow?.vision?.trim()
    );
    const hasPeople = data.people.length > 1; // owner alone doesn't count
    const hasQuarter = Boolean(data.openQuarter);
    const hasPlan = data.sfas.length > 0;
    const candidateSteps: SetupStep[] = [
      {
        key: "foundation",
        label: "Set the foundation",
        description:
          "Purpose, vision, and core values — the north star everything else hangs from.",
        href: "/foundation",
        done: hasFoundation,
      },
      {
        key: "people",
        label: "Invite the team",
        description:
          "Add the leadership team so commitments and coaching have real names to land on.",
        href: "/people",
        done: hasPeople,
      },
      {
        key: "quarter",
        label: "Open a quarter",
        description:
          "Quarters bracket every plan and action. Nothing can be added until one is open.",
        href: "/quarters",
        done: hasQuarter,
      },
      {
        key: "plan",
        label: "Build the plan",
        description:
          "Strategic Focus Areas → annual goals → 90-day priorities. Start with one Focus Area.",
        href: "/plan",
        done: hasPlan,
      },
    ];
    const anyIncomplete = candidateSteps.some((s) => !s.done);
    if (anyIncomplete) setupSteps = candidateSteps;
  }

  const { measures: ownedMeasures, weekEnding: measuresWeekEnding } =
    perfTrackingOn
      ? await getMeasuresOwnedBy(
          companyId,
          session.profile.id,
          data.company.timezone,
          isAdmin
        )
      : { measures: [], weekEnding: "" };
  const pendingMeasures = ownedMeasures.filter(
    (m) => m.auto_track && m.currentValue === null
  );

  // Generative "gaining ground / streaks / wins / worth a
  // conversation" cards for the whole company. Only compute when
  // the flag is on; the cards render nothing when there's no data.
  const measureInsights = perfTrackingOn
    ? await getMeasureInsights(companyId, data.company.timezone)
    : null;
  // Managers get the Coach column for rows they own via
  // profiles.reports_to — same rule as the coaching_conversations
  // insert policy in migration 0021. If they don't manage anyone on
  // the roster there's no point showing the column at all.
  const managesAnyone = data.people.some(
    (p) => p.reports_to === session.profile.id,
  );
  const showCoachColumn = isAdmin || managesAnyone;

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
              caption="Focus Areas this quarter"
              tooltip="Average progress across your Strategic Focus Areas this quarter. Rolls up from action-level progress and reflects only strategic commitments — operational (unlinked) commitments don't count here."
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
            <HeroStat
              label="On Track"
              caption="Actions pacing to hit target"
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
        </div>
      </section>

      {/* ============ Content, overlapping the hero ============ */}
      <div className={styles.content}>
        {setupSteps ? (
          <SetupChecklist
            steps={setupSteps}
            companyName={data.company.name}
          />
        ) : null}

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

        {pendingMeasures.length > 0 ? (
          <PendingMeasuresCard
            measures={pendingMeasures}
            weekEnding={measuresWeekEnding}
          />
        ) : null}

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
      </div>
    </div>
  );
}

