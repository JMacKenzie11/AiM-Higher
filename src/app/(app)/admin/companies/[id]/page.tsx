import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { canViewCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCompanyFeatures } from "@/lib/subscriptions/service";
import { getBulkResetImpact } from "@/lib/plan/service";
import { BulkResetButton } from "@/app/(app)/plan/BulkResetButton";
import type {
  Company,
  MeetingAdminRow,
  TranscriptAlias,
  TranscriptSource,
} from "@/lib/types";
import { getConnectedGoogleAccount } from "@/lib/transcripts/providers/google-drive";
import styles from "../admin.module.css";
import { getAssignedAccess } from "@/lib/admin/assigned-access";
import { AssignedAccessList } from "./AssignedAccessList";
import { FeaturesForm } from "./FeaturesForm";
import { IndustryForm } from "./IndustryForm";
import { TimezoneForm } from "./TimezoneForm";
import { CompanyRowActions } from "../CompanyRowActions";
import { CompanyNameLink } from "../CompanyNameLink";
import { CompanyTranscriptsPanel } from "./CompanyTranscriptsPanel";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// One row of company_settings_events, narrowed to the timezone
// changes this page renders. `actor` is null for a service-role write
// (provisioning, a migration), which honestly means "not a user
// action" rather than "unknown user".
type TimezoneChange = {
  old_value: string | null;
  new_value: string | null;
  occurred_at: string;
  actor: { full_name: string } | null;
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ oauth_connected?: string; oauth_error?: string }>;
};

export default async function CompanyDetailPage({
  params,
  searchParams,
}: PageProps) {
  const session = await requireRole([
    "system_admin",
    "aims_guide",
    "company_admin",
    "portfolio_admin",
  ]);
  const { id } = await params;
  const flash = await searchParams;
  const isSystemAdmin = session.profile.role === "system_admin";
  const isCompanyAdmin = session.profile.role === "company_admin";
  // The container role. Everything below that is gated on
  // `isSystemAdmin || isPortfolioAdmin` is an item on the closed list
  // in migration 0192; everything gated on `isSystemAdmin` alone is
  // not, and Delete is the one to look at twice.
  const isPortfolioAdmin = session.profile.role === "portfolio_admin";
  const managesContainer = isSystemAdmin || isPortfolioAdmin;
  // A guide can only view companies they're assigned to; a company
  // admin can only view their own company. isAdminForCompany covers
  // both cases (see src/lib/auth/permissions.ts).
  // canViewCompany, not isAdminForCompany: this is an access gate,
  // and a portfolio_admin may view every company on the instance. The
  // write affordances further down still ask isAdminForCompany, which
  // does not admit them, so the page renders read-only for this role
  // apart from the container controls it is entitled to.
  if (!canViewCompany(session.profile, id)) {
    redirect("/admin/companies");
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const [
    { data: company },
    { data: aliases },
    { data: sources },
    { data: meetings },
    connectedAccount,
    assignedAccess,
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("*")
      .eq("id", id)
      .maybeSingle<Company>(),
    supabase
      .from("transcript_aliases")
      .select("*")
      .eq("company_id", id)
      .order("created_at"),
    supabase
      .from("transcript_sources")
      .select("*")
      .eq("company_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("meetings")
      // Column list, not "*": Meeting carries transcript_text and this
      // panel renders metadata only. See MeetingAdminRow.
      .select(
        "id, meeting_title, file_name, status, error, created_at, source_id"
      )
      .eq("company_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    getConnectedGoogleAccount(id),
    // Returns empty for a caller the database does not admit, so this
    // is safe to fetch unconditionally. The card below is what decides
    // whether to render it, and for an aims_guide it does not.
    getAssignedAccess(id),
  ]);

  if (!company) notFound();

  const features = await getCompanyFeatures(company.id);
  const aliasRows = (aliases ?? []) as TranscriptAlias[];
  const sourceRows = (sources ?? []) as TranscriptSource[];
  const meetingRows = (meetings ?? []) as MeetingAdminRow[];

  // Fetch the "how many things will this archive" counts for anyone
  // who might see the Planning cycle card (system admin or company
  // admin). Guides never see the card so they skip the query.
  const resetImpact =
    isSystemAdmin || isCompanyAdmin
      ? await getBulkResetImpact(company.id)
      : { sfaCount: 0, goalCount: 0, priorityCount: 0 };
  // The last few times this company's clock moved, and who moved it.
  //
  // The record exists so a scorecard that reads differently this week
  // than last can be explained (migration 0189). An explanation only
  // reachable by writing SQL does not explain anything to the person
  // who noticed, so it renders here, next to the control that causes
  // it. system_admin only: they are the only role that can make the
  // change, and the only role the SELECT policy admits.
  const timezoneHistory = managesContainer
    ? (
        (
          await supabase
            .from("company_settings_events")
            .select("old_value, new_value, occurred_at, actor:profiles!actor_id(full_name)")
            .eq("company_id", id)
            .eq("field", "timezone")
            .order("occurred_at", { ascending: false })
            .limit(3)
        ).data ?? []
      ) as unknown as TimezoneChange[]
    : [];

  const hasResettable =
    resetImpact.sfaCount +
      resetImpact.goalCount +
      resetImpact.priorityCount >
    0;

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Company settings">
        <div className={styles.heroInner}>
          <Link href="/admin/companies" className={styles.crumbLink}>
            ← All companies
          </Link>
          <p className={styles.eyebrow}>Company settings</p>
          <h1 className={styles.h1}>{company.name}</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            {company.timezone} · {company.status}
            {company.industry ? ` · ${company.industry}` : ""}
          </p>
        </div>
      </section>

      <div className={styles.content}>
        {/* Actions card is only for system admins (archive controls)
            and guides (open + jump). Company admins reach this page
            from their own nav — they don't need a re-entry point
            back into the company they already run. */}
        {!isCompanyAdmin ? (
          <section className={styles.card} aria-labelledby="company-controls">
            <h2 id="company-controls" className={styles.h2}>
              Actions
            </h2>
            <p className={styles.subtitleInline}>
              {managesContainer
                ? "Open the company to work inside it, or archive to hide it from picker lists and stop sign-ins."
                : "Open the company to work inside it."}
            </p>
            <div className={styles.rowActions}>
              <CompanyNameLink
                companyId={company.id}
                name="Open this company →"
              />
              {/* Archive is on the closed list; Delete is not, and
                  they live in the same component. `canDelete` is what
                  separates them here — RLS refuses the delete either
                  way (companies_delete admits system_admin only, and
                  `deleted_at` is absent from 0192's column allowlist),
                  so this is the courtesy half of a boundary that is
                  already enforced below it. */}
              {managesContainer ? (
                <CompanyRowActions
                  companyId={company.id}
                  status={company.status}
                  canDelete={isSystemAdmin}
                />
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Industry — visible to system admins and company admins,
            not to guides (guides don't set brand-level metadata). */}
        {managesContainer || isCompanyAdmin ? (
          <section className={styles.card} aria-labelledby="industry-heading">
            <h2 id="industry-heading" className={styles.h2}>
              Industry
            </h2>
            <IndustryForm
              companyId={company.id}
              initial={company.industry}
            />
          </section>
        ) : null}

        {/* Timezone — system-admin only. Changing it re-dates every
            bucketed read in the app, so it does not sit with the
            roles that administer a single tenant. 0176's column guard
            enforces that below the app. */}
        {managesContainer ? (
          <section className={styles.card} aria-labelledby="timezone-heading">
            <h2 id="timezone-heading" className={styles.h2}>
              Timezone
            </h2>
            <TimezoneForm companyId={company.id} initial={company.timezone} />
            {timezoneHistory.length > 0 ? (
              <ul className={styles.historyList}>
                {timezoneHistory.map((change) => (
                  <li key={change.occurred_at} className={styles.subtitleInline}>
                    {change.old_value ?? "unset"} to{" "}
                    {change.new_value ?? "unset"} on{" "}
                    {new Date(change.occurred_at).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                    {change.actor ? `, by ${change.actor.full_name}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {/* Features — system-admin only (module entitlements). */}
        {managesContainer ? (
          <section className={styles.card} aria-labelledby="features-heading">
            <h2 id="features-heading" className={styles.h2}>
              Features
            </h2>
            <FeaturesForm companyId={company.id} initial={features} />
          </section>
        ) : null}

        {/* Assigned access — who administers this company without
            being part of its team. Spec §1a, decision 9.

            NOT on /people, and that is the decision rather than an
            accident of where it was easy to put. /people is the
            team's page and everybody in the company reads it; two
            non-members in that list means explaining the discrepancy
            to all of them with a badge. The people who need to know
            are the ones who administer the company, and they are the
            ones on this page.

            Guides are excluded even though they reach this page for
            their assigned companies: their own assignments are
            already in Guide HQ, and this is a management surface for
            the people who administer the company rather than for the
            people assigned to it. The database says the same thing —
            assigned_access() returns empty for a guide — so the card
            would be empty anyway, and this keeps the heading from
            appearing above nothing. */}
        {managesContainer || isCompanyAdmin ? (
          <section className={styles.card} aria-labelledby="assigned-access">
            <h2 id="assigned-access" className={styles.h2}>
              Assigned access
            </h2>
            <p className={styles.subtitleInline}>
              People who administer this company without being part of its
              team.
            </p>
            <AssignedAccessList
              companyId={company.id}
              people={assignedAccess}
              canRemove={isSystemAdmin || isCompanyAdmin}
            />
          </section>
        ) : null}

        <CompanyTranscriptsPanel
          companyId={company.id}
          connectedAccount={connectedAccount}
          sources={sourceRows}
          meetings={meetingRows}
          aliases={aliasRows}
          flashConnected={flash.oauth_connected ?? null}
          flashError={flash.oauth_error ?? null}
        />

        {/* Planning cycle — open to system admins and company admins.
            hasResettable is currently only fetched for system admins
            (see getBulkResetImpact guard above); do the fetch for
            company admins too so the card can decide whether to show. */}
        {(isSystemAdmin || isCompanyAdmin) && hasResettable ? (
          <section className={styles.card} aria-labelledby="planning-cycle">
            <h2 id="planning-cycle" className={styles.h2}>
              Planning cycle
            </h2>
            <p className={styles.subtitleInline}>
              Archives every active Focus Area, Goal, and
              Quarterly Priority in this company so the team can build the next
              cycle from a clean canvas. Nothing is deleted — records stay
              on file. Open commitments become Operational (unlinked);
              resolved commitments keep their historical link so past-quarter
              progress stays intact. Prefer closing individual items? Every
              Focus Area, Goal, and Priority has its own Archive / Mark complete
              controls on its detail page.
            </p>
            <div>
              <BulkResetButton
                companyId={company.id}
                sfaCount={resetImpact.sfaCount}
                goalCount={resetImpact.goalCount}
                priorityCount={resetImpact.priorityCount}
              />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
