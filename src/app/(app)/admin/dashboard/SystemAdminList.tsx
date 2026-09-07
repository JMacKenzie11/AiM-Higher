import type { SystemAdminRow } from "@/lib/admin/system-admins";
import { RowActionsMenu } from "@/app/(app)/people/RowActionsMenu";
import styles from "./dashboard.module.css";

// The roster half of the "System admins" card.
//
// Reuses the /people row menu rather than growing a second copy of
// Send invite / Copy invite link / Delete. Those three actions
// already handle a company-less profile correctly: each one routes
// its permission check through canManageProfileIn(), which returns
// true for a system_admin regardless of the target's company.
//
// Deactivate is deliberately not offered. Status on this list is
// about whether the invite has been accepted; a system admin who
// should no longer have access should be deleted, not parked in a
// state where the row still reads like an administrator.

type Props = {
  admins: SystemAdminRow[];
  // The signed-in admin, so the menu never offers them a Delete that
  // the action would refuse anyway.
  currentProfileId: string;
};

export function SystemAdminList({ admins, currentProfileId }: Props) {
  if (admins.length === 0) {
    // Not reachable in practice: you have to be a system admin to see
    // this page. Rendered anyway so the card is never a bare heading.
    return (
      <p className={styles.emptyNote} data-testid="system-admin-list-empty">
        No system admins yet.
      </p>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.activityTable} data-testid="system-admin-list">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Status</th>
            <th scope="col">Added</th>
            {/* Labelled but unlabelled visually: the column holds
                the row menu, and a visible "Actions" heading over a
                single icon button is noise. There is no sr-only
                utility in this codebase, so the label goes on the
                cell rather than into a span that would render. */}
            <th scope="col" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {admins.map((admin) => (
            <tr
              key={admin.id}
              className={styles.activityRow}
              data-testid="system-admin-row"
              data-profile-id={admin.id}
            >
              <td>
                {admin.full_name}
                {admin.id === currentProfileId ? " (you)" : ""}
              </td>
              <td>{admin.email ?? "no sign-in on file"}</td>
              <td>{statusLabel(admin.status)}</td>
              <td>{shortDate(admin.created_at)}</td>
              <td>
                <RowActionsMenu
                  profileId={admin.id}
                  status={admin.status}
                  canDelete={admin.id !== currentProfileId}
                  canToggleStatus={false}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusLabel(status: SystemAdminRow["status"]): string {
  if (status === "pending") return "Invite not accepted";
  if (status === "inactive") return "Deactivated";
  return "Active";
}

function shortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
