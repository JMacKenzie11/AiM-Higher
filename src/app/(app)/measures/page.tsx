import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMeasuresTree } from "@/lib/measures/service";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { formatShortDate } from "@/lib/dates";
import { loadExternalPanel } from "@/lib/external-measures/service";
import { ExternalMeasuresProvider } from "./external/ExternalMeasuresContext";
import { MeasuresManager } from "./MeasuresManager";
import { PageShell } from "@/components/ui/PageShell";
import styles from "../admin/companies/admin.module.css";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Critical Success Factors — one surface for both authoring the CSF
// / measure tree and logging weekly values. The chart page defers
// the "what are we measuring" question here so it can stay a chart.
//
// Board (top) reads 13 weeks vs. target. Manager (bottom) is the
// single source for adding outcomes, adding measures under them,
// editing targets, and logging this week's value. The tracking
// columns and filter chips disappear when the company doesn't have
// Success Tracking on — the page becomes a pure authoring surface.

export default async function MeasuresPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const isAdmin = isAdminForCompany(session.profile, companyId);

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string }>();
  const timezone = company?.timezone ?? "America/Anchorage";

  // The tree only. The Board moved to /dashboard, so this page no
  // longer loads it — which also retires getMeasuresPageData, whose
  // whole reason for existing was that these two surfaces sat on one
  // page and would otherwise have fetched the same five reads twice.
  // They are on two pages now and each loads its own spine, which is
  // the correct shape for that and was the wrong one before.
  // role_descriptions is no longer read here. It gated the KPI add
  // form's "draft from the role description" affordance, and 0216
  // removed the KPI add form; the flag still gates the role
  // description surfaces on /chart, which is where it belongs.
  const [tree, trackingEnabled, externalEnabled] = await Promise.all([
    getMeasuresTree(companyId, session.profile.id, timezone, isAdmin),
    companyHasFeature(companyId, "performance_tracking"),
    companyHasFeature(companyId, "external_measures"),
  ]);

  const { functions, weekEnding } = tree;

  // External measures, loaded only for a company that has them.
  //
  // Off, this is one boolean and three reads that never happen, and
  // the provider below hands every row the OFF state. That is the
  // whole cost of this feature to the other companies on the
  // instance, and it is deliberately the cost of a flag check rather
  // than of a wider spine.
  //
  // The ids are taken from the tree the page already built, so the
  // panel needs no traversal of its own and cannot disagree with
  // what is on screen about which measures exist.
  const measureIds = functions.flatMap((f) => f.csfs.map((c) => c.id));
  const externalPanel = externalEnabled
    ? await loadExternalPanel(supabase, measureIds, weekEnding, timezone)
    : null;
  const hasAnyMeasure = functions.some((f) => f.csfs.length > 0);

  return (
    <PageShell
      eyebrow="Company"
      title="Critical Success Factors"
      subtitle={
        trackingEnabled ? (
          <>
            Every function&rsquo;s critical success factors. Log the week
            ending {formatShortDate(weekEnding)} for the functions you
            lead.
          </>
        ) : (
          <>
            Every critical success factor, by function. Weekly logging
            turns on when Success Tracking is enabled for the company.
          </>
        )
      }
    >
      {functions.length === 0 ? (
        <EmptyState isAdmin={isAdmin} />
      ) : !hasAnyMeasure && !isAdmin ? (
        <section className={styles.card}>
          <p className={styles.emptyLine}>
            Nobody has set critical success factors for this company yet.
            They live under each function on the Chart, and the person in
            the seat is the one on the hook for the numbers.
          </p>
        </section>
      ) : (
        <ExternalMeasuresProvider
          panel={externalPanel}
          canPull={isAdmin}
          canAdminister={session.profile.role === "system_admin"}
        >
          <MeasuresManager
            functions={functions}
            weekEnding={weekEnding}
            isAdmin={isAdmin}
            trackingEnabled={trackingEnabled}
          />
        </ExternalMeasuresProvider>
      )}
    </PageShell>
  );
}

function EmptyState({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) {
    return (
      <section className={styles.card}>
        <p className={styles.emptyLine}>
          No functions assigned to you yet. Measures live under the functions
          you lead on the Chart.
        </p>
      </section>
    );
  }
  return (
    <section className={styles.card}>
      <p className={styles.emptyLine}>
        No functions in this company yet.{" "}
        <Link href="/chart" className={styles.emptyLink}>
          Build the Functional Chart first
        </Link>
        , then come back here to add critical success factors and KPIs under
        each function.
      </p>
    </section>
  );
}
