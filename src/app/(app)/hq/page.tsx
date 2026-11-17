import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { thisFriday, todayInTimezone } from "@/lib/dates";
import { computeAttentionForCompanies } from "@/lib/hq/attention";
import { loadRecentBriefs } from "@/lib/hq/brief";
import { loadCallSummaries, loadSessionCard } from "@/lib/hq/calls";
import { dueThisWeekCount } from "@/lib/hq/derive";
import {
  loadCaseload,
  loadCompanyRollups,
  loadMyCommitments,
  loadRecentActivity,
} from "@/lib/hq/service";
import { loadCoachingCallsHq } from "@/lib/coaching-calls/hq";
import { PageShell } from "@/components/ui/PageShell";
import { AnalysisTabs } from "../leadership/meetings/[id]/AnalysisTabs";
import { MyCommitmentsSection } from "./MyCommitmentsSection";
import { YourCompaniesSection } from "./YourCompaniesSection";
import { RecentActivitySection } from "./RecentActivitySection";
import { RecordingsSection } from "./RecordingsSection";
import { WaitingSection } from "./WaitingSection";
import { CallsPanel } from "./CallsPanel";
import type { SessionPanelData } from "@/lib/hq/session-actions";
import styles from "./hq.module.css";
import t from "./hq-tabs.module.css";

export const metadata = { title: "Coach HQ" };

// COACH HQ. The home base for AiMS Coaches and system admins, scoped to
// the caller's own guide_assignments regardless of role: a sysadmin
// with three assignments sees exactly those three; zero assignments
// hits a distinct empty state, not a fallback to global scope.
//
// Two tabs below the hero (nothing in the hero), each answering one
// question. Companies (#companies): who needs me this week, and how is
// each company doing. Coaching calls (#coaching-calls): what calls are
// waiting, what was said, and what do I bring to the next session.
// The tabs are plain anchors, so a link can open either; Prepare links
// carry ?company=<id>, which chooses the company on the second tab.

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export default async function GuideHqPage({
  searchParams,
}: {
  searchParams?: Promise<{ oauth_connected?: string; oauth_error?: string; company?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const session = await requireRole(["aims_guide", "system_admin"]);
  const profileId = session.profile.id;

  // Scope-cookie handling on entry lives in middleware.ts.

  const caseload = await loadCaseload(profileId);
  const companyIds = caseload.map((c) => c.id);
  const zeroCaseload = caseload.length === 0;
  // Only a company in the caseload can be chosen; anything else is
  // ignored, never an error.
  const chosen = caseload.find((c) => c.id === params.company) ?? null;

  // "My commitments" always fetches, even for zero-caseload callers:
  // a guide between assignments may still own commitments.
  const [myCommitments, attention, rollups, activity, coachingCalls, callRows, sessionCard, briefs] =
    await Promise.all([
      loadMyCommitments(profileId),
      zeroCaseload ? Promise.resolve([]) : computeAttentionForCompanies(companyIds),
      zeroCaseload ? Promise.resolve([]) : loadCompanyRollups(companyIds),
      zeroCaseload ? Promise.resolve([]) : loadRecentActivity(companyIds),
      // The coach's own folder of coaching calls (0326).
      zeroCaseload
        ? Promise.resolve(null)
        : loadCoachingCallsHq({ id: profileId, name: session.profile.full_name }, caseload),
      zeroCaseload ? Promise.resolve([]) : loadCallSummaries(caseload),
      chosen ? loadSessionCard(chosen) : Promise.resolve(null),
      chosen ? loadRecentBriefs(chosen.id, 1) : Promise.resolve([]),
    ]);

  const isAdmin = session.profile.role === "system_admin" || session.profile.role === "company_admin";
  // Rows span many companies, so today is resolved in UTC.
  const todayIso = todayInTimezone("UTC").iso;
  const dueThisWeek = dueThisWeekCount(myCommitments, thisFriday("UTC"));
  const waitingCount = coachingCalls?.toSort.length ?? 0;
  const needsYou = new Set(attention.map((a) => a.companyId));

  const subtitle = zeroCaseload
    ? "The companies you coach, and the calls you have with them."
    : `${countWord(caseload.length)} ${caseload.length === 1 ? "company" : "companies"}. ${
        attention.length === 0
          ? "None needs you this week."
          : `${countWord(attention.length)} ${attention.length === 1 ? "needs" : "need"} you this week.`
      }`;

  const commitmentsSection = (
    <MyCommitmentsSection rows={myCommitments} currentUserId={profileId} todayIso={todayIso} isAdmin={isAdmin} />
  );

  if (zeroCaseload) {
    return (
      <PageShell
        eyebrow={session.profile.role === "system_admin" ? "System admin" : "AiMS Coach"}
        title="Coach HQ"
        subtitle={subtitle}
        ariaLabel="Coach HQ header"
        flush
      >
        <section className={styles.zeroCard} aria-labelledby="hq-zero">
          <h2 id="hq-zero" className={styles.zeroTitle}>
            No coaching assignments yet
          </h2>
          <p className={styles.zeroBody}>
            You&rsquo;re not currently assigned as a coach to any company. A system admin can add you from the AiMS
            Coaches panel on{" "}
            <Link className={styles.zeroLink} href="/admin/companies">
              the Companies page
            </Link>
            . Your own commitments (below) still appear here so you can act on them.
          </p>
        </section>
        {commitmentsSection}
      </PageShell>
    );
  }

  const companiesTab = (
    <>
      {/* Your companies first (Jason, 2026-11-17). The coach's own
          commitments have their own tab, Your commitments, last. */}
      <YourCompaniesSection rows={rollups} needsYou={needsYou} nowMs={Date.now()} />
      <section aria-label="This week" className={t.tiles}>
        <a href="#hq-companies" className={t.tile}>
          <span className={t.tileNumber}>{attention.length}</span>
          <span className={t.tileLabel}>
            {attention.length === 1 ? "company needs you" : "companies need you"}
          </span>
        </a>
        <a href="#your-commitments" className={t.tile}>
          <span className={t.tileNumber}>{dueThisWeek}</span>
          <span className={t.tileLabel}>
            of your commitments due this week
          </span>
        </a>
        <a href="#coaching-calls" className={t.tile}>
          <span className={t.tileNumber}>{waitingCount}</span>
          <span className={t.tileLabel}>
            {waitingCount === 1 ? "call waiting to be analysed" : "calls waiting to be analysed"}
          </span>
        </a>
      </section>
      <RecentActivitySection items={activity} />
    </>
  );

  const initialSession: SessionPanelData | null =
    chosen && sessionCard
      ? {
          companyId: chosen.id,
          card: sessionCard,
          promises: myCommitments.filter(
            (c) => c.company_id === chosen.id && c.status === "open" && !c.deleted_at && !c.parked_at
          ),
          brief: briefs[0]
            ? { id: briefs[0].id, content: briefs[0].content_markdown, createdAt: briefs[0].created_at }
            : null,
        }
      : null;

  const callsTab = (
    <>
      {coachingCalls ? (
        <RecordingsSection
          data={coachingCalls}
          companies={caseload}
          today={todayIso}
          flash={{ connected: params.oauth_connected ?? null, error: params.oauth_error ?? null }}
        />
      ) : null}
      {coachingCalls ? <WaitingSection data={coachingCalls} companies={caseload} /> : null}
      {/* Chips, the session card and the call list: a chip switches at
          once, without reloading the page (CallsPanel). */}
      <CallsPanel companies={caseload} rows={callRows} initial={initialSession} />
    </>
  );

  return (
    <PageShell
      eyebrow={session.profile.role === "system_admin" ? "System admin" : "AiMS Coach"}
      title="Coach HQ"
      subtitle={subtitle}
      ariaLabel="Coach HQ header"
      flush
    >
      <AnalysisTabs
        label="Coach HQ"
        tabs={[
          { hash: "companies", label: "Companies", content: companiesTab },
          {
            hash: "coaching-calls",
            label: "Coaching calls",
            badge: waitingCount > 0 ? `${waitingCount} waiting` : undefined,
            content: callsTab,
          },
          // The coach's own commitments, across every company, on a tab
          // of their own after Coaching calls (Jason, 2026-11-17). The
          // "due this week" tile on Companies links here (#your-commitments).
          {
            hash: "your-commitments",
            label: "Your commitments",
            badge: dueThisWeek > 0 ? `${dueThisWeek} due this week` : undefined,
            content: commitmentsSection,
          },
        ]}
      />
    </PageShell>
  );
}
