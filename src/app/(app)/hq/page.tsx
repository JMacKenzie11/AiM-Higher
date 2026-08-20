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
import styles from "./hq.module.css";

// Guide HQ — the home base for AiMS Guides and system admins. Scoped
// to the caller's own guide_assignments regardless of role. A sysadmin
// with three assignments sees exactly those three; zero assignments
// hits a distinct empty state, not a fallback to global scope.

export default async function GuideHqPage() {
  const session = await requireRole(["aims_guide", "system_admin"]);
  const profileId = session.profile.id;

  const caseload = await loadCaseload(profileId);
  const companyIds = caseload.map((c) => c.id);
  const zeroCaseload = caseload.length === 0;

  // "My commitments" always fetches, even for zero-caseload callers —
  // a guide who's between assignments may still own commitments in
  // companies where they used to coach, and their sysadmin overseer
  // may have assigned them commitments across their own board.
  const [myCommitments, attention, rollups, activity, briefsMap] =
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

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Guide HQ header">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>
            {session.profile.role === "system_admin"
              ? "System admin"
              : "AiMS Guide"}
          </p>
          <h1 className={styles.h1}>Guide HQ</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Your commitments across every company, the attention queue
            for this week, and a quick read on the shape of your
            caseload.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        {zeroCaseload ? (
          <section className={styles.zeroCard} aria-labelledby="hq-zero">
            <h2 id="hq-zero" className={styles.zeroTitle}>
              No coaching assignments yet
            </h2>
            <p className={styles.zeroBody}>
              You&rsquo;re not currently assigned as a guide to any
              company. A system admin can add you from the AiMS Guides
              panel on{" "}
              <Link className={styles.zeroLink} href="/admin/companies">
                the Companies page
              </Link>
              . Your own commitments (below) still appear here so you
              can act on them.
            </p>
          </section>
        ) : null}

        <MyCommitmentsSection
          rows={myCommitments}
          currentUserId={profileId}
          todayIso={todayIso}
          isAdmin={isAdmin}
        />

        {!zeroCaseload ? (
          <>
            <NeedsAttentionSection rows={attention} />
            <YourCompaniesSection
              rows={rollups}
              recentBriefsByCompany={briefsByCompany}
            />
            <RecentActivitySection items={activity} />
          </>
        ) : null}
      </div>
    </div>
  );
}
