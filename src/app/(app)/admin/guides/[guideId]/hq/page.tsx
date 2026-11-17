import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { todayInTimezone } from "@/lib/dates";
import { computeAttentionForCompanies } from "@/lib/hq/attention";
import {
  loadCaseload,
  loadCompanyRollups,
  loadMyCommitments,
  loadRecentActivity,
} from "@/lib/hq/service";
import { MyCommitmentsSection } from "../../../../hq/MyCommitmentsSection";
import { YourCompaniesSection } from "../../../../hq/YourCompaniesSection";
import { RecentActivitySection } from "../../../../hq/RecentActivitySection";
import styles from "../../../../hq/hq.module.css";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

export const metadata = { title: "Coach HQ" };

// Sysadmin oversight view of another guide's Guide HQ. Sourced by
// guideId instead of the caller's own id, and rendered read-only:
// every mutation control (resolve, reschedule, park, reassign, delete,
// reword, notes) is off, in the rows and in the drawer they open.
// Navigational affordances (click a company to scope in, open a
// meeting analysis) stay live.
//
// isAdmin stays true for the navigation it unlocks (the From meeting
// link); readOnly is what switches the edits off. Before it reached
// the row, isAdmin alone left delete and rewording live here. The
// system admin's database rights are unchanged: this is app-level.
//
// Works identically whether guideId points to an aims_guide or a
// system_admin profile.

type PageProps = { params: Promise<{ guideId: string }> };

export default async function AdminGuideHqPage({ params }: PageProps) {
  const session = await requireRole(["system_admin"]);
  const { guideId } = await params;

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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

  const [myCommitments, attention, rollups, activity] =
    await Promise.all([
      loadMyCommitments(guideId),
      zeroCaseload
        ? Promise.resolve([])
        : computeAttentionForCompanies(companyIds),
      zeroCaseload ? Promise.resolve([]) : loadCompanyRollups(companyIds),
      zeroCaseload ? Promise.resolve([]) : loadRecentActivity(companyIds),
    ]);

  const todayIso = todayInTimezone("UTC").iso;

  return (
    <div className={styles.stage}>
      <section
        className={styles.hero}
        aria-label={`Coach HQ for ${guide.full_name}`}
      >
        <div className={styles.heroInner}>
          <Link href="/admin/companies" className={styles.eyebrow}>
            ← All companies
          </Link>
          <p className={styles.eyebrow}>
            System admin · Viewing {guide.full_name}&rsquo;s Coach HQ
          </p>
          <h1 className={styles.h1}>Coach HQ</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Read-only oversight of {guide.full_name}&rsquo;s coaching
            board. You can&rsquo;t change their commitments on this
            view. Open a company to act on anything you see here.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <div className={styles.readOnlyBanner} role="status">
          You&rsquo;re viewing {guide.full_name}&rsquo;s Coach HQ.
          Nothing here can be changed. Links still work. Session briefs
          and coaching calls are the coach&rsquo;s own and stay on their
          Coach HQ.
        </div>

        {zeroCaseload ? (
          <section className={styles.zeroCard} aria-labelledby="hq-zero">
            <h2 id="hq-zero" className={styles.zeroTitle}>
              No coaching assignments
            </h2>
            <p className={styles.zeroBody}>
              {guide.full_name} isn&rsquo;t currently assigned as a
              coach to any company. Their own commitments (below) still
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
          title={`${guide.full_name}’s commitments`}
        />

        {!zeroCaseload ? (
          <>
            <YourCompaniesSection
              rows={rollups}
              attention={attention}
              prepare={false}
              nowMs={Date.now()}
            />
            <RecentActivitySection items={activity} />
          </>
        ) : null}
      </div>
    </div>
  );
}
