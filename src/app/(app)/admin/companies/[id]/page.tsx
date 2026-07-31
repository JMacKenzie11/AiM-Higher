import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCompanyFeatures } from "@/lib/subscriptions/service";
import type {
  Company,
  Meeting,
  Profile,
  TranscriptAlias,
  TranscriptSource,
} from "@/lib/types";
import { getConnectedGoogleAccount } from "@/lib/transcripts/providers/google-drive";
import styles from "../admin.module.css";
import { InviteForm } from "./InviteForm";
import { UserRowActions } from "./UserRowActions";
import { FeaturesForm } from "./FeaturesForm";
import { CompanyRowActions } from "../CompanyRowActions";
import { CompanyNameLink } from "../CompanyNameLink";
import { AliasEditor } from "./AliasEditor";
import { CompanyTranscriptsPanel } from "./CompanyTranscriptsPanel";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ oauth_connected?: string; oauth_error?: string }>;
};

function statusChipClass(status: Profile["status"]): string {
  switch (status) {
    case "pending":
      return styles.chipPending;
    case "inactive":
      return styles.chipInactive;
    default:
      return styles.chipActive;
  }
}

export default async function CompanyDetailPage({
  params,
  searchParams,
}: PageProps) {
  const session = await requireRole(["system_admin"]);
  const { id } = await params;
  const flash = await searchParams;

  const supabase = await createSupabaseServerClient();

  const [
    { data: company },
    { data: profiles },
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
      .from("profiles")
      .select("*")
      .eq("company_id", id)
      .order("full_name"),
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
  const roster = (profiles ?? []) as Profile[];
  const aliasRows = (aliases ?? []) as TranscriptAlias[];
  const sourceRows = (sources ?? []) as TranscriptSource[];
  const meetingRows = (meetings ?? []) as Meeting[];

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
            Open the company to work inside it, or archive to hide it from
            picker lists and stop sign-ins.
          </p>
          <div className={styles.rowActions}>
            <CompanyNameLink
              companyId={company.id}
              name="Open this company →"
            />
            <CompanyRowActions
              companyId={company.id}
              status={company.status}
            />
          </div>
        </section>

        <section className={styles.card} aria-labelledby="features-heading">
          <h2 id="features-heading" className={styles.h2}>
            Features
          </h2>
          <FeaturesForm companyId={company.id} initial={features} />
        </section>

        <section className={styles.card} aria-labelledby="people">
          <h2 id="people" className={styles.h2}>
            People
          </h2>
          {roster.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Position</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className={styles.actionHead}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((profile) => (
                  <tr key={profile.id}>
                    <td>{profile.full_name}</td>
                    <td className={styles.mutedCell}>
                      {profile.position ?? "—"}
                    </td>
                    <td className={styles.capCell}>
                      {profile.role.replace("_", " ")}
                    </td>
                    <td>
                      <span className={statusChipClass(profile.status)}>
                        {profile.status}
                      </span>
                    </td>
                    <td>
                      <UserRowActions
                        profileId={profile.id}
                        status={profile.status}
                        canDelete={profile.id !== session.profile.id}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={styles.emptyLine}>
              No one on this company yet. Add the first person below.
            </p>
          )}
        </section>

        <section className={styles.card} aria-labelledby="add-person">
          <h2 id="add-person" className={styles.h2}>
            Add a person
          </h2>
          <InviteForm companyId={company.id} />
        </section>

        {flash.oauth_connected || flash.oauth_error ? (
          <section
            className={styles.card}
            aria-live="polite"
            aria-label="Google connection status"
          >
            {flash.oauth_connected ? (
              <p className={styles.successMessage} role="status">
                Connected as {flash.oauth_connected}.
              </p>
            ) : null}
            {flash.oauth_error ? (
              <p className={styles.errorMessage} role="alert">
                Couldn&rsquo;t connect: {flash.oauth_error}
              </p>
            ) : null}
          </section>
        ) : null}

        <CompanyTranscriptsPanel
          companyId={company.id}
          connectedAccount={connectedAccount}
          sources={sourceRows}
          meetings={meetingRows}
        />

        <section className={styles.card} aria-labelledby="aliases">
          <h2 id="aliases" className={styles.h2}>
            Transcript aliases
          </h2>
          <p className={styles.subtitleInline}>
            When a shared Google Drive folder serves multiple companies,
            transcript file names are matched (case-insensitive substring)
            against these aliases to decide who a meeting belongs to.
          </p>
          <AliasEditor companyId={company.id} aliases={aliasRows} />
        </section>
      </div>
    </div>
  );
}
