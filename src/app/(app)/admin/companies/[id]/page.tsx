import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCompanyFeatures } from "@/lib/subscriptions/service";
import type { Company, Profile } from "@/lib/types";
import styles from "../admin.module.css";
import { InviteForm } from "./InviteForm";
import { UserRowActions } from "./UserRowActions";
import { FeaturesForm } from "./FeaturesForm";
import { CompanyRowActions } from "../CompanyRowActions";
import { CompanyNameLink } from "../CompanyNameLink";

type PageProps = {
  params: Promise<{ id: string }>;
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

export default async function CompanyDetailPage({ params }: PageProps) {
  const session = await requireRole(["system_admin"]);
  const { id } = await params;

  const supabase = await createSupabaseServerClient();

  const [{ data: company }, { data: profiles }] = await Promise.all([
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
  ]);

  if (!company) notFound();

  const features = await getCompanyFeatures(company.id);
  const roster = (profiles ?? []) as Profile[];

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
      </div>
    </div>
  );
}
