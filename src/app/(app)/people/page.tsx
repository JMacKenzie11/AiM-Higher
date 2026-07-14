import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getPeopleRoster } from "@/lib/people/service";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { InviteForm } from "../admin/companies/[id]/InviteForm";
import { InvitationRow } from "../admin/companies/[id]/InvitationRow";
import { PersonStatusToggle } from "./PersonStatusToggle";
import styles from "./people.module.css";

// People roster — Section 8.6.

export default async function PeoplePage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const { people, pendingInvitations } = await getPeopleRoster(companyId);
  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="People summary">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Roster</p>
          <h1 className={styles.h1}>People</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Everyone on the team, with how their week is going.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.card} aria-labelledby="roster">
          <h2 id="roster" className={styles.h2}>
            Team
          </h2>
          {people.length === 0 ? (
            <p className={styles.emptyLine}>
              No one on the roster yet.{" "}
              {isAdmin ? "Send the first invitation below." : ""}
            </p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Position</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className={styles.numHead}>Open</th>
                  <th>Follow-through rate</th>
                  {isAdmin ? <th className={styles.actionHead}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <Link
                        href={`/people/${person.id}`}
                        className={styles.personLink}
                      >
                        {person.full_name}
                      </Link>
                    </td>
                    <td className={styles.mutedCell}>
                      {person.position ?? "—"}
                    </td>
                    <td className={styles.capCell}>
                      {person.role.replace("_", " ")}
                    </td>
                    <td>
                      <span
                        className={
                          person.status === "active"
                            ? styles.chipActive
                            : styles.chipInactive
                        }
                      >
                        {person.status}
                      </span>
                    </td>
                    <td className={`${styles.numCell} aims-tabular`}>
                      {person.openCount}
                    </td>
                    <td className={styles.keepRateCell}>
                      <ProgressBar
                        percent={person.keepRate}
                        label="No resolved commitments"
                      />
                    </td>
                    {isAdmin ? (
                      <td className={styles.actionsCell}>
                        <PersonStatusToggle
                          personId={person.id}
                          currentStatus={person.status}
                          disabled={person.id === session.profile.id}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {isAdmin ? (
          <section className={styles.card} aria-labelledby="invite-person">
            <h2 id="invite-person" className={styles.h2}>
              Invite a person
            </h2>
            <InviteForm companyId={companyId} />
          </section>
        ) : null}

        {isAdmin && pendingInvitations.length > 0 ? (
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
                  <InvitationRow
                    key={invitation.id}
                    invitation={invitation}
                  />
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </div>
  );
}
