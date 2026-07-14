import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Company, Invitation, Profile } from "@/lib/types";
import styles from "../admin.module.css";
import { InviteForm } from "./InviteForm";
import { InvitationRow } from "./InvitationRow";
import { CompanyRowActions } from "../CompanyRowActions";
import { CompanyNameLink } from "../CompanyNameLink";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function CompanyDetailPage({ params }: PageProps) {
  await requireRole(["system_admin"]);
  const { id } = await params;

  const supabase = await createSupabaseServerClient();

  const [{ data: company }, { data: profiles }, { data: invitations }] =
    await Promise.all([
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
        .from("invitations")
        .select("*")
        .eq("company_id", id)
        .order("created_at", { ascending: false }),
    ]);

  if (!company) notFound();

  const pendingInvitations = (invitations as Invitation[] | null)?.filter(
    (row) => row.status === "pending"
  );
  const otherInvitations = (invitations as Invitation[] | null)?.filter(
    (row) => row.status !== "pending"
  );

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

        <section className={styles.card} aria-labelledby="people">
          <h2 id="people" className={styles.h2}>
            People
          </h2>
          {profiles && profiles.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Position</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(profiles as Profile[]).map((profile) => (
                  <tr key={profile.id}>
                    <td>{profile.full_name}</td>
                    <td className={styles.mutedCell}>
                      {profile.position ?? "—"}
                    </td>
                    <td className={styles.capCell}>
                      {profile.role.replace("_", " ")}
                    </td>
                    <td>
                      <span
                        className={
                          profile.status === "active"
                            ? styles.chipActive
                            : styles.chipInactive
                        }
                      >
                        {profile.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={styles.emptyLine}>
              No one on this company yet. Send the first invitation below.
            </p>
          )}
        </section>

        <section className={styles.card} aria-labelledby="invite">
          <h2 id="invite" className={styles.h2}>
            Invite someone
          </h2>
          <InviteForm companyId={company.id} />
        </section>

        {pendingInvitations && pendingInvitations.length > 0 ? (
          <section className={styles.card} aria-labelledby="pending-invites">
            <h2 id="pending-invites" className={styles.h2}>
              Pending invitations
            </h2>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Expires</th>
                  <th className={styles.actionHead}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingInvitations.map((invitation) => (
                  <InvitationRow key={invitation.id} invitation={invitation} />
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {otherInvitations && otherInvitations.length > 0 ? (
          <section className={styles.card} aria-labelledby="past-invites">
            <h2 id="past-invites" className={styles.h2}>
              Invitation history
            </h2>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {otherInvitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>{invitation.full_name}</td>
                    <td className={styles.mutedCell}>{invitation.email}</td>
                    <td>
                      <span
                        className={
                          invitation.status === "accepted"
                            ? styles.chipAccepted
                            : styles.chipRevoked
                        }
                      >
                        {invitation.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </div>
  );
}
