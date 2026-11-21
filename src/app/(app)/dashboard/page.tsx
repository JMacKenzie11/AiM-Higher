import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { canWriteOwnedRow, isAdminForCompany } from "@/lib/auth/permissions";
import { getDashboardData } from "@/lib/dashboard/service";
import { getWelcomeData } from "@/lib/welcome/data";
import { BriefSection, BriefLoading } from "./BriefSection";
import { CompanyDashboard } from "./CompanyDashboard";
import { WelcomeBoard } from "./WelcomeBoard";
import styles from "./welcome.module.css";

export const metadata = { title: "Dashboard" };

// THE DASHBOARD, where a company lands (Jason, 2026-11-21). One header,
// "Welcome to <company>", and two tabs:
//
//   This week   the Scoreboard: recap video, last week's Follow-Through,
//               done this week, the week in review, the honor roll and
//               the open commitments ahead (welcome/WelcomeBoard.tsx)
//   Dashboard   the company dashboard, Section 8.2 (CompanyDashboard.tsx)
//
// The tab is in the address (?tab=dashboard), so a link can open either,
// and only the open tab's data is read.

type Tab = "week" | "dashboard";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  // Cross-tenant roles land on Guide HQ as their default home base.
  // Company admins and team members always have a company.
  const crossTenantHome =
    session.profile.role === "system_admin" || session.profile.role === "aims_guide" ? "/hq" : "/admin/companies";
  if (!companyId) redirect(crossTenantHome);

  const data = await getDashboardData(companyId);
  if (!data) redirect(crossTenantHome);

  const { tab: tabParam } = await searchParams;
  const tab: Tab = tabParam === "dashboard" ? "dashboard" : "week";
  const firstName = session.profile.full_name?.trim().split(/\s+/)[0] || "there";
  const isAdmin = isAdminForCompany(session.profile, companyId);

  const week = tab === "week" ? await getWelcomeData(companyId, session.profile.id, data.company.timezone) : null;
  const meeting = week ? (week.recap?.meeting ?? week.latestMeeting) : null;
  const subline = week
    ? meeting
      ? `Your week, from ${meeting.title}, ${meeting.date}`
      : "Your week at a glance"
    : "How this quarter and this week are going";

  return (
    <div className={styles.page}>
      <header className={`${styles.head} ${styles.pop}`}>
        <div>
          <div className={styles.hi}>Good to see you, {firstName}.</div>
          <h1 className={styles.h1}>Welcome to {data.company.name}</h1>
          <div className={styles.sub}>{subline}</div>
        </div>
        {week?.recap?.isNew ? (
          <span className={styles.live}>
            <i aria-hidden="true" />
            New recap this week
          </span>
        ) : null}
      </header>

      <nav className={styles.tabs} aria-label="Dashboard views">
        <Link href="/dashboard" className={styles.tab} aria-current={tab === "week" ? "page" : undefined}>
          This week
        </Link>
        <Link href="/dashboard?tab=dashboard" className={styles.tab} aria-current={tab === "dashboard" ? "page" : undefined}>
          Dashboard
        </Link>
      </nav>

      {week ? (
        <WelcomeBoard
          recap={week.recap}
          followThrough={{
            rate: week.lastWeek.followThrough.rate,
            keptOnTime: week.lastWeek.followThrough.keptOnTime,
            resolved: week.lastWeek.followThrough.resolved,
          }}
          honor={week.lastWeek.honor}
          wins={week.wins}
          brief={
            // An admin's visit generates today's brief; everyone else
            // reads the latest one (0253). Streamed, so the board shows
            // while the model call runs.
            <Suspense fallback={<BriefLoading />}>
              <BriefSection companyId={companyId} adminId={session.profile.id} canGenerate={isAdmin} />
            </Suspense>
          }
          open={week.open}
          writable={week.open.filter((c) => canWriteOwnedRow(session.profile, c)).map((c) => c.id)}
          todayIso={week.todayIso}
          currentUserId={session.profile.id}
          isAdmin={isAdmin}
          roster={week.roster}
          priorityOptions={week.priorityOptions}
          functionalAreaOptions={week.functionalAreaOptions}
        />
      ) : (
        <div className={styles.dashTab}>
          <CompanyDashboard profile={session.profile} companyId={companyId} data={data} />
        </div>
      )}
    </div>
  );
}
