import type { SystemAdminRow } from "@/lib/admin/system-admins";
import { RowActionsMenu } from "@/app/(app)/people/RowActionsMenu";
import styles from "./dashboard.module.css";

// The roster half of the "System admins" card AND of the "Portfolio
// admins" card below it. Two roles, one table, because the columns
// and the row menu are identical for both.
//
// Which one it is has to be passed in, because the empty state is the
// one place the two differ in words. It used to hardcode "No system
// admins yet", so the Portfolio admins card answered a question
// nobody had asked: a person looking for a portfolio admin they had
// just added was told there were no SYSTEM admins, which is true,
// unrelated, and reads like a bug in the thing they were checking.
// That happened, and it cost a real diagnosis.
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
  // Which roster this is. Only the empty state reads it; everything
  // else about the two is the same.
  variant?: "system_admin" | "portfolio_admin";
  // The signed-in admin, so the menu never offers them a Delete that
  // the action would refuse anyway.
  currentProfileId: string;
};

export function SystemAdminList({
  admins,
  currentProfileId,
  variant = "system_admin",
}: Props) {
  const isPortfolio = variant === "portfolio_admin";
  if (admins.length === 0) {
    // For system admins this is not reachable in practice: you have to
    // be one to see this page. For portfolio admins it very much is —
    // an instance can run with none — so this sentence is the whole
    // answer somebody gets to "where did the person I added go".
    return (
      <p
        className={styles.emptyNote}
        data-testid={
          isPortfolio ? "portfolio-admin-list-empty" : "system-admin-list-empty"
        }
      >
        {isPortfolio
          ? "No portfolio admins yet. Add one below, or check the company's People page if you meant to add a company admin."
          : "No system admins yet."}
      </p>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table
        className={styles.activityTable}
        data-testid={isPortfolio ? "portfolio-admin-list" : "system-admin-list"}
      >
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
