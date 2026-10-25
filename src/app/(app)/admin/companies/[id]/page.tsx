import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { canViewCompany, isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { companyHasFeature, getCompanyFeatures } from "@/lib/subscriptions/service";
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
import { ChampionForm, type ChampionCandidate } from "./ChampionForm";
import { CompanyRowActions } from "../CompanyRowActions";
import { CompanyNameLink } from "../CompanyNameLink";
import { CompanyTranscriptsPanel } from "./CompanyTranscriptsPanel";
import { CompanyConnectionsCard } from "./CompanyConnectionsCard";
import type { ConnectionRow } from "@/lib/connections/vault";
import { QuarterCard } from "./QuarterCard";
import { getQuarterCardData } from "@/lib/quarters/service";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { AssistantsSwitchForm } from "./AssistantsSwitchForm";
import { mcpOpenTo } from "@/lib/mcp/switch";
import { mcpEnabledHere } from "@/lib/mcp/switch-here";

export const metadata = { title: "Company settings" };

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
  // Set by the Google sign-in callback, for the Connections card.
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
    { data: connectionRows },
    hubspotOn,
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
    // The Connections card. Read under the caller's own session, so
    // someone the database does not admit (0257) gets none.
    supabase
      .from("connections")
      .select("id, company_id, connector, status, account_label, scopes, secret_hint, checked_at, last_error")
      .eq("company_id", id),
    companyHasFeature(id, "external_measures"),
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
  // Same audience as the Planning cycle card above it, so the same
  // guard: a guide never sees either and skips both queries.
  const quarterCard =
    isSystemAdmin || isCompanyAdmin
      ? await getQuarterCardData(company.id)
      : null;
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

  // Who the champion seat may point at: this company's own active
  // people. The membership trigger in 0235 refuses anybody else, so
  // a wider list would be a list of options that cannot be chosen.
  const championCandidates: ChampionCandidate[] =
    isSystemAdmin || isCompanyAdmin
      ? (
          (
            await supabase
              .from("profiles")
              .select("id, full_name")
              .eq("company_id", id)
              .eq("status", "active")
              .order("full_name")
          ).data ?? []
        ) as ChampionCandidate[]
      : [];

  const hasResettable =
    resetImpact.sfaCount +
      resetImpact.goalCount +
      resetImpact.priorityCount >
    0;

  // The page is arranged by the job someone came to do (Jason,
  // 2026-10-25), the way the left menu is: the routine quarterly act
  // first, then what the company plugs into, who helps run it, the
  // facts set once, and starting over last and on its own. Each card
  // keeps its own audience; a group shows when any card in it does.
  const mcpCard =
    (await mcpEnabledHere()) &&
    mcpOpenTo(session.profile.role) &&
    (isSystemAdmin || isCompanyAdmin || session.profile.role === "aims_guide");
  const connectionsCard = isAdminForCompany(session.profile, company.id);
  const championCard = isSystemAdmin || isCompanyAdmin;
  const assignedCard = managesContainer || isCompanyAdmin;
  const industryCard = managesContainer || isCompanyAdmin;
  const startOverCard = (isSystemAdmin || isCompanyAdmin) && hasResettable;

  const groups = [
    { id: "quarter", label: "Quarter", shown: quarterCard !== null },
    // The transcripts panel renders for every caller, so this group
    // always shows.
    { id: "connections", label: "Connections", shown: true },
    { id: "people", label: "People", shown: championCard || assignedCard },
    { id: "company", label: "Company", shown: industryCard || managesContainer },
    { id: "start-over", label: "Start over", shown: startOverCard },
  ].filter((g) => g.shown);

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
          <div className={styles.settingsHeroRow}>
            <nav aria-label="Sections" className={styles.settingsJump}>
              {groups.map((g) => (
                <a key={g.id} href={`#${g.id}`}>
                  {g.label}
                </a>
              ))}
            </nav>
            {/* The way into the company, for the roles that work
                across companies. A company admin reaches this page
                from inside their own company and needs no way back in. */}
            {!isCompanyAdmin ? (
              <CompanyNameLink
                companyId={company.id}
                name="Open this company →"
                className={styles.heroOpen}
              />
            ) : null}
          </div>
        </div>
      </section>

      <div className={`${styles.content} ${styles.settingsContent}`}>
        {quarterCard ? (
          <SettingsGroup id="quarter" label="Quarter">
            <QuarterCard
              companyId={company.id}
              openQuarter={quarterCard.openQuarter}
              suggestion={quarterCard.suggestion}
              carryCount={quarterCard.carryCount}
            />
          </SettingsGroup>
        ) : null}

        {/* `#connections` is also where the Google sign-in callback
            and the old Connections page's address land. */}
        <SettingsGroup id="connections" label="Connections">
          {/* Connections: the outside systems this company is
              connected to, managed here by the people decision 3 of
              the external connections plan names (isAdminForCompany). */}
          {connectionsCard ? (
            <CompanyConnectionsCard
              companyId={company.id}
              connections={(connectionRows ?? []) as ConnectionRow[]}
              hubspotOn={hubspotOn}
              flash={flash}
            />
          ) : null}

          <CompanyTranscriptsPanel
            companyId={company.id}
            connectedAccount={connectedAccount}
            sources={sourceRows}
            meetings={meetingRows}
            aliases={aliasRows}
          />

          {/* Outside assistants (0279): the company's own switch, on
              by default since 0284. Shown where MCP is on for this
              instance, to the people who may flip it: a system admin,
              the company's admin or an assigned guide. Never a
              portfolio admin, whose role assistants are not open to. */}
          {mcpCard ? (
            <section className={styles.accentCard} aria-labelledby="assistants-heading">
              <h2 id="assistants-heading" className={styles.h2}>
                Connect AI apps
              </h2>
              <AssistantsSwitchForm
                companyId={company.id}
                companyName={company.name}
                initial={company.assistants_enabled === true}
              />
            </section>
          ) : null}
        </SettingsGroup>

        {championCard || assignedCard ? (
          <SettingsGroup id="people" label="People">
            {/* AiMS champion — the company's own admins, not the
                container roles. It is a decision about this team,
                made by this team. The column guard in 0235 draws the
                same line below the app. */}
            {championCard ? (
              <section className={styles.accentCard} aria-labelledby="champion-heading">
                <h2 id="champion-heading" className={styles.h2}>
                  AiMS champion
                </h2>
                <ChampionForm
                  companyId={company.id}
                  initial={company.aims_champion_profile_id}
                  candidates={championCandidates}
                />
              </section>
            ) : null}

            {/* Assigned access — who administers this company without
                being part of its team. Spec §1a, decision 9.

                NOT on /people, and that is the decision rather than an
                accident of where it was easy to put. /people is the
                team's page and everybody in the company reads it; two
                non-members in that list means explaining the
                discrepancy to all of them with a badge.

                Guides are excluded: their own assignments are already
                in Guide HQ, and assigned_access() returns empty for a
                guide, so the card would be empty anyway. */}
            {assignedCard ? (
              <section className={styles.accentCard} aria-labelledby="assigned-access">
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
          </SettingsGroup>
        ) : null}

        {industryCard || managesContainer ? (
          <SettingsGroup id="company" label="Company">
            {/* Industry — system admins, portfolio admins and company
                admins, not guides (guides don't set brand-level
                metadata). */}
            {industryCard ? (
              <section className={styles.accentCard} aria-labelledby="industry-heading">
                <h2 id="industry-heading" className={styles.h2}>
                  Industry
                </h2>
                <IndustryForm
                  companyId={company.id}
                  initial={company.industry}
                />
              </section>
            ) : null}

            {/* Timezone — the container roles only. Changing it
                re-dates every bucketed read in the app, so it does not
                sit with the roles that administer a single tenant.
                0176's column guard enforces that below the app. */}
            {managesContainer ? (
              <section className={styles.accentCard} aria-labelledby="timezone-heading">
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

            {/* Features — the container roles only (module
                entitlements). */}
            {managesContainer ? (
              <section className={styles.accentCard} aria-labelledby="features-heading">
                <h2 id="features-heading" className={styles.h2}>
                  Features
                </h2>
                <FeaturesForm companyId={company.id} initial={features} />
              </section>
            ) : null}

            {/* Archive is on the closed list; Delete is not, and they
                live in the same component. `canDelete` is what
                separates them here — RLS refuses the delete either way
                (companies_delete admits system_admin only, and
                `deleted_at` is absent from 0192's column allowlist),
                so this is the courtesy half of a boundary that is
                already enforced below it. */}
            {managesContainer ? (
              <section className={styles.accentCard} aria-labelledby="archive-heading">
                <h2 id="archive-heading" className={styles.h2}>
                  Archive
                </h2>
                <p className={styles.subtitleInline}>
                  Archiving hides the company from picker lists and stops its
                  people signing in.
                </p>
                <div className={styles.settingsActions}>
                  <CompanyRowActions
                    companyId={company.id}
                    status={company.status}
                    canDelete={isSystemAdmin}
                  />
                </div>
              </section>
            ) : null}
          </SettingsGroup>
        ) : null}

        {/* Starting over — system admins and company admins, and only
            when there is something to archive. Last and on its own so
            it is never read as the way to the next quarter, which is
            the Quarter card at the top. */}
        {startOverCard ? (
          <SettingsGroup id="start-over" label="Start over">
            <section className={styles.accentCard} aria-labelledby="planning-cycle">
              <h2 id="planning-cycle" className={styles.h2}>
                Start the strategy again
              </h2>
              <p className={styles.subtitleInline}>
                <strong>
                  To move to the next quarter, use the Quarter card at the top
                  of this page.
                </strong>{" "}
                It carries unfinished priorities with it. This clears the whole
                plan: every Focus Area and Goal as well as every Quarterly
                Priority. It is what you do after an annual planning session,
                when the team is rewriting the strategy rather than continuing
                it.
              </p>
              <p className={styles.subtitleInline}>
                Nothing is deleted and records stay on file. Open commitments
                become Operational (unlinked); resolved commitments keep their
                historical link so past progress stays intact. Closing a few
                items instead? Every Focus Area, Goal and Priority has its own
                Archive and Mark complete controls on its detail page.
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
          </SettingsGroup>
        ) : null}
      </div>
    </div>
  );
}

// One job on the page: a heading in the left menu's section style,
// and the cards for that job under it. The id is the jump link's
// target.
function SettingsGroup({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={styles.settingsGroup} aria-labelledby={`${id}-group`}>
      <p id={`${id}-group`} className={styles.settingsGroupLabel}>
        {label}
      </p>
      {children}
    </section>
  );
}
