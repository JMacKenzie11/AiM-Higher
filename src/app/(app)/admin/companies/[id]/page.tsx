import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCompanyFeatures } from "@/lib/subscriptions/service";
import { getBulkResetImpact } from "@/lib/plan/service";
import { BulkResetButton } from "@/app/(app)/plan/BulkResetButton";
import type {
  Company,
  Meeting,
  TranscriptAlias,
  TranscriptSource,
} from "@/lib/types";
import { getConnectedGoogleAccount } from "@/lib/transcripts/providers/google-drive";
import styles from "../admin.module.css";
import { FeaturesForm } from "./FeaturesForm";
import { CompanyRowActions } from "../CompanyRowActions";
import { CompanyNameLink } from "../CompanyNameLink";
import { CompanyTranscriptsPanel } from "./CompanyTranscriptsPanel";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ oauth_connected?: string; oauth_error?: string }>;
};

export default async function CompanyDetailPage({
  params,
  searchParams,
}: PageProps) {
  const session = await requireRole(["system_admin", "aims_guide"]);
  const { id } = await params;
  const flash = await searchParams;
  const isSystemAdmin = session.profile.role === "system_admin";
  // A guide can only view companies they're assigned to.
  if (!isAdminForCompany(session.profile, id)) {
    redirect("/admin/companies");
  }

  const supabase = await createSupabaseServerClient();

  const [
    { data: company },
    { data: aliases },
    { data: sources },
    { data: meetings },
    connectedAccount,
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
      .select("*")
      .eq("company_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    getConnectedGoogleAccount(id),
  ]);

  if (!company) notFound();

  const features = await getCompanyFeatures(company.id);
  const aliasRows = (aliases ?? []) as TranscriptAlias[];
  const sourceRows = (sources ?? []) as TranscriptSource[];
  const meetingRows = (meetings ?? []) as Meeting[];

  const resetImpact = isSystemAdmin
    ? await getBulkResetImpact(company.id)
    : { sfaCount: 0, goalCount: 0, priorityCount: 0 };
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
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.card} aria-labelledby="company-controls">
          <h2 id="company-controls" className={styles.h2}>
            Actions
          </h2>
          <p className={styles.subtitleInline}>
            {isSystemAdmin
              ? "Open the company to work inside it, or archive to hide it from picker lists and stop sign-ins."
              : "Open the company to work inside it."}
          </p>
          <div className={styles.rowActions}>
            <CompanyNameLink
              companyId={company.id}
              name="Open this company →"
            />
            {isSystemAdmin ? (
              <CompanyRowActions
                companyId={company.id}
                status={company.status}
              />
            ) : null}
          </div>
        </section>

        {isSystemAdmin ? (
          <section className={styles.card} aria-labelledby="features-heading">
            <h2 id="features-heading" className={styles.h2}>
              Features
            </h2>
            <FeaturesForm companyId={company.id} initial={features} />
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

        {isSystemAdmin && hasResettable ? (
          <section className={styles.card} aria-labelledby="planning-cycle">
            <h2 id="planning-cycle" className={styles.h2}>
              Planning cycle
            </h2>
            <p className={styles.subtitleInline}>
              Archives every active Strategic Focus Area, Annual Goal, and
              90-Day Priority in this company so the team can build the next
              cycle from a clean canvas. Nothing is deleted — records stay
              on file. Open commitments become Operational (unlinked);
              resolved commitments keep their historical link so past-quarter
              progress stays intact. Prefer closing individual items? Every
              SFA, Goal, and Priority has its own Archive / Mark complete
              actions on its detail page.
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
