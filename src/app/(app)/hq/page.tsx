import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { todayInTimezone } from "@/lib/dates";
import { computeAttentionForCompanies } from "@/lib/hq/attention";
import {
  loadRecentBriefsForCompanies,
  type SessionBriefRow,
} from "@/lib/hq/brief";
import {
  loadCaseload,
  loadCompanyRollups,
  loadMyCommitments,
  loadRecentActivity,
} from "@/lib/hq/service";
import { MyCommitmentsSection } from "./MyCommitmentsSection";
import { NeedsAttentionSection } from "./NeedsAttentionSection";
import { YourCompaniesSection } from "./YourCompaniesSection";
import { RecentActivitySection } from "./RecentActivitySection";
import { CoachingCallsSection } from "./CoachingCallsSection";
import { loadCoachingCallsHq } from "@/lib/coaching-calls/hq";
import { PageShell } from "@/components/ui/PageShell";
import styles from "./hq.module.css";
import { simplifyOn } from "@/lib/ui/simplify";

export const metadata = { title: "Coach HQ" };

// Guide HQ — the home base for AiMS Guides and system admins. Scoped
// to the caller's own guide_assignments regardless of role. A sysadmin
// with three assignments sees exactly those three; zero assignments
// hits a distinct empty state, not a fallback to global scope.

export default async function GuideHqPage({
  searchParams,
}: {
  searchParams?: Promise<{ oauth_connected?: string; oauth_error?: string }>;
}) {
  const flash = (await searchParams) ?? {};
  const session = await requireRole(["aims_guide", "system_admin"]);
  const profileId = session.profile.id;

  // Scope-cookie clear on entry lives in middleware.ts (Next.js
  // forbids cookie mutation from a server-component render). See
  // the /hq branch in middleware for the clearing logic.

  const caseload = await loadCaseload(profileId);
  const companyIds = caseload.map((c) => c.id);
  const zeroCaseload = caseload.length === 0;

  // "My commitments" always fetches, even for zero-caseload callers —
  // a guide who's between assignments may still own commitments in
  // companies where they used to coach, and their sysadmin overseer
  // may have assigned them commitments across their own board.
  const [myCommitments, attention, rollups, activity, briefsMap, coachingCalls] =
    await Promise.all([
      loadMyCommitments(profileId),
      zeroCaseload
        ? Promise.resolve([])
        : computeAttentionForCompanies(companyIds),
      zeroCaseload ? Promise.resolve([]) : loadCompanyRollups(companyIds),
      zeroCaseload ? Promise.resolve([]) : loadRecentActivity(companyIds),
      zeroCaseload
        ? Promise.resolve(new Map<string, SessionBriefRow[]>())
        : loadRecentBriefsForCompanies(companyIds),
      // The coach's own folder of coaching calls (0326).
      zeroCaseload
        ? Promise.resolve(null)
        : loadCoachingCallsHq({ id: profileId, name: session.profile.full_name }, caseload),
    ]);
  // Client-component prop needs to be a serializable object, not a Map.
  const briefsByCompany: Record<string, SessionBriefRow[]> = Object.fromEntries(
    briefsMap
  );

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  // Guide HQ owns its own tenant boundary: rows span many companies,
  // so we resolve today in the caller's own timezone via the profile
  // (falls back to UTC when unset).
  const todayIso = todayInTimezone("UTC").iso;

  const shortHq = simplifyOn("short-intros");

  return (
    <PageShell
      eyebrow={
        session.profile.role === "system_admin" ? "System admin" : "AiMS Coach"
      }
      title="Coach HQ"
      subtitle={
        // One line under the "short-intros" switch (change 10).
        simplifyOn("short-intros")
          ? "The companies that need you this week, and your caseload."
          : "Your commitments across every company, the attention queue for this week, and a quick read on the shape of your caseload."
      }
      ariaLabel="Coach HQ header"
    >
      {zeroCaseload ? (
          <section className={styles.zeroCard} aria-labelledby="hq-zero">
            <h2 id="hq-zero" className={styles.zeroTitle}>
              No coaching assignments yet
            </h2>
            <p className={styles.zeroBody}>
              You&rsquo;re not currently assigned as a coach to any
              company. A system admin can add you from the AiMS Coaches
              panel on{" "}
              <Link className={styles.zeroLink} href="/admin/companies">
                the Companies page
              </Link>
              .
              {/* True only with "short-intros" off. With it on, My
                  commitments renders only beside a caseload (below),
                  so a guide with none sees no commitments here. */}
              {shortHq
                ? null
                : " Your own commitments (below) still appear here so you can act on them."}
            </p>
          </section>
        ) : null}

        {/* Under the "short-intros" switch (simplification review,
            change 10) a guide's own commitments come after the queue,
            and only when there are some: an empty "My commitments" was
            the first thing a guide read most days. */}
        {!shortHq ? (
          <MyCommitmentsSection
            rows={myCommitments}
            currentUserId={profileId}
            todayIso={todayIso}
            isAdmin={isAdmin}
          />
        ) : null}

      {!zeroCaseload ? (
        <>
          <NeedsAttentionSection rows={attention} />
          {coachingCalls ? (
            <CoachingCallsSection
              data={coachingCalls}
              companies={caseload}
              flash={{
                connected: flash.oauth_connected ?? null,
                error: flash.oauth_error ?? null,
              }}
            />
          ) : null}
          {shortHq && myCommitments.length > 0 ? (
            <MyCommitmentsSection
              rows={myCommitments}
              currentUserId={profileId}
              todayIso={todayIso}
              isAdmin={isAdmin}
            />
          ) : null}
          <YourCompaniesSection
            rows={rollups}
            recentBriefsByCompany={briefsByCompany}
          />
          <RecentActivitySection items={activity} />
        </>
      ) : null}
    </PageShell>
  );
}
