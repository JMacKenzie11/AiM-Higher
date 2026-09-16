import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { getCompaniesOverview } from "@/lib/admin/companies-service";
import {
  getGuidesOverview,
  getSysadminsForCaseloadPicker,
} from "@/lib/admin/guides-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProgressBar } from "@/components/plan/ProgressBar";
import type { MeetingListRow } from "@/lib/types";
import { CompanyNameLink } from "./CompanyNameLink";
import { CompanyRowActions } from "./CompanyRowActions";
import { CreateCompanyForm } from "./CreateCompanyForm";
import { CompaniesTable } from "./CompaniesTable";
import { GuidesPanel } from "./GuidesPanel";
import { PlatformTranscriptsPanel } from "./PlatformTranscriptsPanel";
import styles from "./admin.module.css";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { ScopeIntoCompanyButton } from "./ScopeIntoCompanyButton";

// Companies overview — the fleet view.
//   system_admin sees every company + management affordances (Create,
//   Archive, Guides admin, unrouted queue).
//   aims_guide sees only their assigned companies, with no
//   create/archive/guides-admin surface.
//   Clicking a company name scopes into it and jumps straight to its
//   dashboard (see CompanyNameLink). Per-row Settings link goes to
//   /admin/companies/[id].

type PageProps = {
  searchParams: Promise<{ oauth_connected?: string; oauth_error?: string }>;
};

export default async function AdminCompaniesPage({ searchParams }: PageProps) {
  const session = await requireRole([
    "system_admin",
    "aims_guide",
    "company_admin",
    "portfolio_admin",
  ]);
  // Company admins don't have a list view — they only ever manage
  // their own company. Send them straight to that company's settings
  // page so /admin/companies is a single navigable entry point for
  // every admin role, even though what they see when they land is
  // scoped to one company.
  if (session.profile.role === "company_admin") {
    if (!session.profile.company_id) {
      // Defensive — a company_admin without a company_id shouldn't
      // exist, but if one somehow does, kick them home instead of
      // 500ing.
      redirect("/");
    }
    redirect(`/admin/companies/${session.profile.company_id}`);
  }
  const isSystemAdmin = session.profile.role === "system_admin";
  // The portfolio owner sees the same list a system admin does, and
  // reaches every company on it. What they see is decided by RLS:
  // companies_select_portfolio (0191) admits every row, and
  // getCompaniesOverview reads through the caller's own client, so no
  // branch is needed here to widen it. The branches BELOW are about
  // platform administration (guide caseloads, the unrouted-meeting
  // queue, creating companies) and stay system_admin's, with the one
  // exception noted on the create form.
  const isPortfolioAdmin = session.profile.role === "portfolio_admin";

  const [companies, flash, guides, sysadminCandidates] = await Promise.all([
    getCompaniesOverview(),
    searchParams,
    isSystemAdmin ? getGuidesOverview() : Promise.resolve([]),
    isSystemAdmin
      ? getSysadminsForCaseloadPicker()
      : Promise.resolve([]),
  ]);

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  // Unrouted queue is only meaningful for the sysadmin who manages
  // routing across the platform; guides don't need it in their view.
  const unrouted: MeetingListRow[] = [];
  if (isSystemAdmin) {
    const { data: unroutedRows } = await supabase
      .from("meetings")
      // Metadata only — the unrouted queue shows file name and date.
      .select("id, meeting_title, file_name, status, error, created_at")
      .eq("status", "unrouted")
      .order("created_at", { ascending: false });
    unrouted.push(...((unroutedRows ?? []) as MeetingListRow[]));
  }

  const oauthConnected = flash.oauth_connected ?? null;
  const oauthError = flash.oauth_error ?? null;

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Companies summary">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>
            {isSystemAdmin
              ? "System admin"
              : isPortfolioAdmin
                ? "Portfolio admin"
                : "AiMS Guide"}
          </p>
          <h1 className={styles.h1}>Companies</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            {isSystemAdmin
              ? "Every company on the AiMS HQ Platform. Click a name to jump into its dashboard."
              : isPortfolioAdmin
                ? "Every company in your portfolio. Click a name to jump into its dashboard. You can read everything and change nothing inside a company; settings, features and people are yours."
                : "The companies you coach. Click a name to jump into its dashboard."}
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.card} aria-labelledby="companies-list">
          <h2 id="companies-list" className={styles.h2}>
            All companies
          </h2>
          {companies.length === 0 ? (
            <p className={styles.emptyLine}>
              No companies yet. Create the first one below.
            </p>
          ) : (
            /* Ordering the portfolio belongs to the two roles whose
               scope IS the portfolio. A guide sees the same list and
               cannot reorder it, which the column guard on `companies`
               enforces below the app: sort_order is on the
               portfolio_admin allowlist and refused to everybody
               smaller. */
            <CompaniesTable
              canReorder={isSystemAdmin || isPortfolioAdmin}
              header={
                <>
                  <th>Name</th>
                  <th className={styles.numHead}>People</th>
                  <th>Open quarter</th>
                  <th>Follow-Through Rate</th>
                  <th>Status</th>
                  <th className={styles.actionHead}>Actions</th>
                </>
              }
              /* Cells rendered HERE and passed as nodes. They cannot
                 be passed as a function that renders them: React
                 refuses a function across the server/client boundary
                 unless it is a server action, and it refuses it at
                 render time rather than at build time. A ReactNode is
                 already part of the RSC payload and crosses fine. */
              rows={companies.map((company) => ({
                id: company.id,
                name: company.name,
                cells: (
                  <>
                    <td>
                      <CompanyNameLink
                        companyId={company.id}
                        name={company.name}
                      />
                      <p className={styles.companyMeta}>{company.timezone}</p>
                    </td>
                    <td className={`${styles.numCell} aims-tabular`}>
                      {company.peopleCount}
                    </td>
                    <td className={styles.mutedCell}>
                      {company.openQuarterLabel ?? "—"}
                    </td>
                    <td className={styles.keepRateCell}>
                      <ProgressBar
                        percent={company.keepRate}
                        label="No resolved commitments"
                      />
                    </td>
                    <td>
                      <span
                        className={
                          company.status === "active"
                            ? styles.chipActive
                            : styles.chipInactive
                        }
                      >
                        {company.status}
                      </span>
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <ScopeIntoCompanyButton
                          companyId={company.id}
                          destination={`/admin/companies/${company.id}`}
                          className={styles.ghostButton}
                        >
                          Settings
                        </ScopeIntoCompanyButton>
                        {isSystemAdmin ? (
                          <CompanyRowActions
                            companyId={company.id}
                            status={company.status}
                          />
                        ) : null}
                      </div>
                    </td>
                  </>
                ),
              }))}
            />
          )}
        </section>

        {/* Creating a company is item 1 of portfolio_admin's closed
            list, so this card is theirs as well as the system
            admin's. Archiving (CompanyRowActions above) is also
            theirs, but it lives in the same component as Delete,
            which is not — so that one stays system-admin-only here
            and a portfolio_admin archives from the company's own
            settings page. RLS refuses their delete either way. */}
        {isSystemAdmin || isPortfolioAdmin ? (
          <section className={styles.card} aria-labelledby="create-company">
            <h2 id="create-company" className={styles.h2}>
              Create a new company
            </h2>
            <CreateCompanyForm />
          </section>
        ) : null}

        {isSystemAdmin ? (
          <GuidesPanel
            guides={guides}
            companies={companies.map((c) => ({ id: c.id, name: c.name }))}
            sysadminCandidates={sysadminCandidates}
            // Attention count intentionally NOT computed here — it was
            // one live scorecard compute per company per page load,
            // which balloons quickly as caseloads grow. The value is
            // still visible on each guide's /hq surface where it
            // actually matters; the panel column is a nice-to-have.
            attentionCountByGuideId={{}}
          />
        ) : null}

        {oauthConnected || oauthError ? (
          <section
            className={styles.card}
            aria-live="polite"
            aria-label="Google connection status"
          >
            {oauthConnected ? (
              <p className={styles.successMessage} role="status">
                Connected as {oauthConnected}.
              </p>
            ) : null}
            {oauthError ? (
              <p className={styles.errorMessage} role="alert">
                Couldn&rsquo;t connect: {oauthError}
              </p>
            ) : null}
          </section>
        ) : null}

        <PlatformTranscriptsPanel
          unrouted={unrouted}
          companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        />
      </div>
    </div>
  );
}
