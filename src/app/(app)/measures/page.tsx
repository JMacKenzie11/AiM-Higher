import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGridData } from "@/lib/measures/grid";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { formatWeekBeginning } from "@/lib/dates";
import { loadExternalPanel } from "@/lib/external-measures/service";
import { ExternalMeasuresProvider } from "./external/ExternalMeasuresContext";
import { MeasuresGrid } from "./MeasuresGrid";
import { PageShell } from "@/components/ui/PageShell";
import styles from "../admin/companies/admin.module.css";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Critical Success Factors: the spreadsheet, in the app.
//
// Functional Area, Owner, Critical Success Factor, Frequency, Target,
// then a rolling year of weeks with the current month open and the
// rest collapsed. One surface for both authoring and logging the week. The
// chart page defers the "what are we measuring" question here so it
// can stay a chart.
//
// The tracking columns disappear when the company does not have
// Success Tracking on, and the page becomes a pure authoring
// surface.

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
  // Success Tracking is NOT read here, and that is the point of it.
  // The flag used to decide whether this page had week columns at
  // all, so a company without it got a list it could never record a
  // number against. It now governs only what the Saturday sweep and
  // the Friday nudge do on their own; logging a week is part of the
  // page, for everyone.
  const [grid, externalEnabled] = await Promise.all([
    getGridData(companyId, session.profile.id, timezone, isAdmin),
    companyHasFeature(companyId, "external_measures"),
  ]);

  const { groups, currentWeekEnding: weekEnding } = grid;

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
  const measureIds = groups.flatMap((g) => g.rows.map((r) => r.id));
  const externalPanel = externalEnabled
    ? await loadExternalPanel(supabase, measureIds, weekEnding, timezone)
    : null;
  const hasAnyMeasure = grid.hasRows;

  return (
    <PageShell
      eyebrow="Company"
      title="Critical Success Factors"
      subtitle={
        <>
          Every function&rsquo;s critical success factors. Log the week
          beginning {formatWeekBeginning(weekEnding)} for the functions
          you lead.
        </>
      }
    >
      {groups.length === 0 ? (
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
          <MeasuresGrid
            data={grid}
            weekEnding={weekEnding}
            isAdmin={isAdmin}
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
