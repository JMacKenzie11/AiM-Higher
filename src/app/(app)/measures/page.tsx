import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMeasuresPageData } from "@/lib/measures/page-data";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { formatShortDate } from "@/lib/dates";
import { loadExternalPanel } from "@/lib/external-measures/service";
import { ExternalMeasuresProvider } from "./external/ExternalMeasuresContext";
import { MeasuresManager } from "./MeasuresManager";
import { BoardView } from "./board/BoardView";
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

  // One pass for both surfaces. The Board and the Manager read the
  // same functions, critical success factors, links and KPIs; loading
  // them separately fetched four of five reads twice on every page
  // load. See getMeasuresPageData.
  const [{ tree, board }, trackingEnabled, rdEnabled, externalEnabled] =
    await Promise.all([
      getMeasuresPageData(companyId, session.profile.id, timezone, isAdmin),
      companyHasFeature(companyId, "performance_tracking"),
      companyHasFeature(companyId, "role_descriptions"),
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
  const measureIds = functions.flatMap((f) =>
    f.outcomes.flatMap((o) => [o.id, ...o.measures.map((m) => m.id)])
  );
  const externalPanel = externalEnabled
    ? await loadExternalPanel(supabase, measureIds, weekEnding, timezone)
    : null;
  const boardHasContent =
    board.functions.length > 0 &&
    board.functions.some((f) => f.metrics.length > 0);
  const hasAnyMeasure = functions.some((f) =>
    f.outcomes.some((o) => o.measures.length > 0)
  );

  return (
    <PageShell
      eyebrow="Company"
      title="Critical Success Factors"
      subtitle={
        trackingEnabled ? (
          <>
            Every function&rsquo;s critical success factors and the KPIs
            that drive them. Log the week ending{" "}
            {formatShortDate(weekEnding)} for the functions you lead.
          </>
        ) : (
          <>
            Every critical success factor and the KPIs that drive it, by
            function. Weekly logging turns on when Success Tracking is
            enabled for the company.
          </>
        )
      }
    >
      {trackingEnabled && boardHasContent ? <BoardView data={board} /> : null}

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
            rdEnabled={rdEnabled}
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
