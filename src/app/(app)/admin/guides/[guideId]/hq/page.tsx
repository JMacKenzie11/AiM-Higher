import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { todayInTimezone } from "@/lib/dates";
import { computeAttentionForCompanies } from "@/lib/hq/attention";
import { loadRecentBriefs, type SessionBriefRow } from "@/lib/hq/brief";
import {
  loadCaseload,
  loadCompanyRollups,
  loadMyCommitments,
  loadRecentActivity,
} from "@/lib/hq/service";
import { MyCommitmentsSection } from "../../../../hq/MyCommitmentsSection";
import { NeedsAttentionSection } from "../../../../hq/NeedsAttentionSection";
import { YourCompaniesSection } from "../../../../hq/YourCompaniesSection";
import { RecentActivitySection } from "../../../../hq/RecentActivitySection";
import styles from "../../../../hq/hq.module.css";

// Sysadmin oversight view of another guide's Guide HQ. Sourced by
// guideId instead of the caller's own id, and rendered read-only:
// every mutation control (resolve, reschedule, park, reassign) is
// disabled. Navigational affordances (click a company to scope in,
// open a meeting analysis) stay live.
//
// Works identically whether guideId points to an aims_guide or a
// system_admin profile.

type PageProps = { params: Promise<{ guideId: string }> };

export default async function AdminGuideHqPage({ params }: PageProps) {
  const session = await requireRole(["system_admin"]);
  const { guideId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: guide } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", guideId)
    .maybeSingle<{ id: string; full_name: string; role: string }>();
  if (!guide) notFound();
  if (guide.role !== "aims_guide" && guide.role !== "system_admin") {
    // Not a guide-eligible profile; nothing to render.
    notFound();
  }

  const caseload = await loadCaseload(guideId);
  const companyIds = caseload.map((c) => c.id);
  const zeroCaseload = caseload.length === 0;

  const [myCommitments, attention, rollups, activity, briefsByCompany] =
    await Promise.all([
      loadMyCommitments(guideId),
      zeroCaseload
        ? Promise.resolve([])
        : computeAttentionForCompanies(companyIds),
      zeroCaseload ? Promise.resolve([]) : loadCompanyRollups(companyIds),
      zeroCaseload ? Promise.resolve([]) : loadRecentActivity(companyIds),
      zeroCaseload
        ? Promise.resolve({} as Record<string, SessionBriefRow[]>)
        : Promise.all(
            companyIds.map(async (cid) => [cid, await loadRecentBriefs(cid)] as const)
          ).then((entries) => Object.fromEntries(entries)),
    ]);

  const todayIso = todayInTimezone("UTC").iso;

  return (
    <div className={styles.stage}>
      <section
        className={styles.hero}
        aria-label={`Guide HQ for ${guide.full_name}`}
      >
        <div className={styles.heroInner}>
          <Link href="/admin/companies" className={styles.eyebrow}>
            ← All companies
          </Link>
          <p className={styles.eyebrow}>
            System admin · Viewing {guide.full_name}&rsquo;s Guide HQ
          </p>
          <h1 className={styles.h1}>Guide HQ</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Read-only oversight of {guide.full_name}&rsquo;s coaching
            board. Resolve, reschedule, park, and reassign controls
            are disabled on this view — jump into a company to act on
            anything you see here.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <div className={styles.readOnlyBanner} role="status">
          You&rsquo;re viewing {guide.full_name}&rsquo;s Guide HQ.
          Mutations are disabled here; navigation still works. Session
          Brief generation is available since it has no side effects.
        </div>

        {zeroCaseload ? (
          <section className={styles.zeroCard} aria-labelledby="hq-zero">
            <h2 id="hq-zero" className={styles.zeroTitle}>
              No coaching assignments
            </h2>
            <p className={styles.zeroBody}>
              {guide.full_name} isn&rsquo;t currently assigned as a
              guide to any company. Their own commitments (below) still
              show here.
            </p>
          </section>
        ) : null}

        <MyCommitmentsSection
          rows={myCommitments}
          currentUserId={session.profile.id}
          todayIso={todayIso}
          isAdmin={true}
          readOnly={true}
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
