import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getPeopleRoster } from "@/lib/people/service";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { InviteForm } from "../admin/companies/[id]/InviteForm";
import { RowActionsMenu } from "./RowActionsMenu";
import { TrackOnMount } from "@/lib/analytics/TrackOnMount";
import type { Profile } from "@/lib/types";
import styles from "./people.module.css";
import adminStyles from "../admin/companies/admin.module.css";

// People roster — Section 8.6.

// Supabase's Email OTP Expiration is set at its max — 24h.
// Anything older than this on an unaccepted invite has a dead link.
const INVITE_LINK_EXPIRY_MS = 86400 * 1000;

// Status pill copy + tooltip. profiles.status flips to 'active' inside
// acceptInviteAction the moment the user sets a password on
// /accept-invite, so 'active' is a reliable "signed in successfully"
// signal without needing to peek at auth.users.last_sign_in_at.
// Pending rows split further: if the last invited_at is older than
// the Supabase link expiry the pill switches to a red "Expired" so
// admins know they need to Resend before the user can act on it.
function statusPill(
  status: Profile["status"],
  invitedAt: string | null
): { className: string; label: string; title: string } {
  if (status === "active") {
    return {
      className: styles.chipActive,
      label: "Active",
      title: "Active — accepted the invite",
    };
  }
  if (status === "inactive") {
    return {
      className: styles.chipInactive,
      label: "Inactive",
      title: "Inactive",
    };
  }
  // pending
  if (!invitedAt) {
    return {
      className: adminStyles.chipPending,
      label: "Pending",
      title: "Not yet invited",
    };
  }
  const ageMs = Date.now() - new Date(invitedAt).getTime();
  if (ageMs > INVITE_LINK_EXPIRY_MS) {
    return {
      className: styles.chipExpired,
      label: "Expired",
      title: `Invite link expired (sent ${formatRelativeShort(invitedAt)}). Click Resend invite to send a new one.`,
    };
  }
  return {
    className: adminStyles.chipPending,
    label: "Pending",
    title: `Invited ${formatRelativeShort(invitedAt)}`,
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
      <TrackOnMount event="people.opened" />
      <section className={styles.hero} aria-label="Team summary">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Roster</p>
          <h1 className={styles.h1}>Team</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Everyone on the team, with how their week is going.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.card} aria-label="Roster">
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
                  const pill = statusPill(person.status, person.invited_at);
                  return (
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
                      <span className={pill.className} title={pill.title}>
                        {pill.label}
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
                          <RowActionsMenu
                            profileId={person.id}
                            status={person.status}
                            canDelete={person.id !== session.profile.id}
                            canToggleStatus={
                              person.id !== session.profile.id &&
                              person.status !== "pending"
                            }
                          />
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
