import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getPeopleRoster } from "@/lib/people/service";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { InviteForm } from "../admin/companies/[id]/InviteForm";
import { UserRowActions } from "../admin/companies/[id]/UserRowActions";
import { PersonStatusToggle } from "./PersonStatusToggle";
import type { Profile } from "@/lib/types";
import styles from "./people.module.css";
import adminStyles from "../admin/companies/admin.module.css";

// People roster — Section 8.6.

function statusChipClass(status: Profile["status"]): string {
  switch (status) {
    case "pending":
      return adminStyles.chipPending;
    case "inactive":
      return styles.chipInactive;
    default:
      return styles.chipActive;
  }
}

// Small dot + tooltip that answers "has this person made it in yet?"
// at a glance. profiles.status flips to 'active' inside
// acceptInviteAction the moment the user sets a password on
// /accept-invite, so 'active' is a reliable "signed in successfully"
// signal without needing to peek at auth.users.last_sign_in_at.
function statusIndicator(
  status: Profile["status"],
  invitedAt: string | null
): { className: string; title: string } {
  if (status === "active") {
    return {
      className: `${styles.statusDot} ${styles.statusDotActive}`,
      title: "Active — accepted the invite",
    };
  }
  if (status === "inactive") {
    return {
      className: `${styles.statusDot} ${styles.statusDotInactive}`,
      title: "Inactive",
    };
  }
  // pending
  const title = invitedAt
    ? `Invited ${formatRelativeShort(invitedAt)}, not yet accepted`
    : "Not yet invited";
  return {
    className: `${styles.statusDot} ${styles.statusDotPending}`,
    title,
  };
}

function formatRelativeShort(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMinutes = Math.max(0, Math.round((now - then) / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default async function PeoplePage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const { people } = await getPeopleRoster(companyId);
  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  // A manager reaches the Coach affordance for their direct reports,
  // matching the coaching_conversations insert policy (migration
  // 0021). Only bother rendering the Actions column for managers who
  // actually have reports on this roster.
  const managesAnyone = people.some(
    (p) => p.reports_to === session.profile.id,
  );
  const showActionsColumn = isAdmin || managesAnyone;

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
          <div className={styles.rosterHeader}>
            <h2 id="roster" className={styles.h2}>
              Team
            </h2>
          </div>
          {people.length === 0 ? (
            <p className={styles.emptyLine}>
              No one on the roster yet.{" "}
              {isAdmin ? "Add the first person below." : ""}
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
                  <th>Follow-Through Rate</th>
                  {showActionsColumn ? (
                    <th className={styles.actionHead}>Actions</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {people.map((person) => {
                  const isSelfRow = person.id === session.profile.id;
                  const canCoachPerson =
                    !isSelfRow &&
                    (isAdmin || person.reports_to === session.profile.id);
                  const indicator = statusIndicator(
                    person.status,
                    person.invited_at
                  );
                  return (
                    <tr key={person.id}>
                    <td>
                      <span className={styles.nameCell} title={indicator.title}>
                        <span
                          className={indicator.className}
                          aria-label={indicator.title}
                          role="img"
                        />
                        <Link
                          href={`/people/${person.id}`}
                          className={styles.personLink}
                        >
                          {person.full_name}
                        </Link>
                      </span>
                    </td>
                    <td className={styles.mutedCell}>
                      {person.position ?? "—"}
                    </td>
                    <td className={styles.capCell}>
                      {person.role.replace("_", " ")}
                    </td>
                    <td>
                      <span className={statusChipClass(person.status)}>
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
                    {showActionsColumn ? (
                      <td className={styles.actionsCell}>
                        {canCoachPerson ? (
                          <Link
                            href={`/coach/${person.id}`}
                            className={styles.coachButton}
                          >
                            Coach
                          </Link>
                        ) : null}
                        {isAdmin ? (
                          <>
                            <UserRowActions
                              profileId={person.id}
                              status={person.status}
                              canDelete={person.id !== session.profile.id}
                            />
                            {person.status !== "pending" ? (
                              <PersonStatusToggle
                                personId={person.id}
                                currentStatus={person.status}
                                disabled={person.id === session.profile.id}
                              />
                            ) : null}
                          </>
                        ) : null}
                      </td>
                    ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {isAdmin ? (
          <section className={styles.card} aria-labelledby="add-person">
            <h2 id="add-person" className={styles.h2}>
              Add a person
            </h2>
            <InviteForm companyId={companyId} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
