import type { Company, Profile } from "@/lib/types";
import type { GuideOverviewRow } from "@/lib/admin/guides-service";
import { CreateGuideForm } from "./CreateGuideForm";
import { GuideAssignCell } from "./GuideAssignCell";
import { GuideCompaniesCell } from "./GuideCompaniesCell";
import { GuideRowActions } from "./GuideRowActions";
import styles from "./admin.module.css";

// System-admin surface for managing AiMS Guides. Lists every guide,
// their status (Active / Pending / Expired / Inactive), which
// companies they're assigned to, and row-level actions (assign,
// unassign chips, plus a ⋯ menu for Resend invite / Copy invite
// link / Delete). Not rendered for aims_guides or company_admins.

// Supabase's Email OTP Expiration is 24h (max). An unaccepted
// invite older than this has a dead link — surface as "Expired"
// so the sysadmin knows to resend. Same threshold as /people.
const INVITE_LINK_EXPIRY_MS = 86400 * 1000;

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
      className: styles.chipPending,
      label: "Pending",
      title: "Not yet invited",
    };
  }
  const ageMs = Date.now() - new Date(invitedAt).getTime();
  if (ageMs > INVITE_LINK_EXPIRY_MS) {
    return {
      className: styles.chipExpired,
      label: "Expired",
      title: `Invite link expired (sent ${formatRelativeShort(invitedAt)}). Use Resend invite to send a new one.`,
    };
  }
  return {
    className: styles.chipPending,
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

export function GuidesPanel({
  guides,
  companies,
}: {
  guides: GuideOverviewRow[];
  companies: Pick<Company, "id" | "name">[];
}) {
  return (
    <section className={styles.card} aria-labelledby="aims-guides">
      <h2 id="aims-guides" className={styles.h2}>
        AiMS Guides
      </h2>
      <p className={styles.subtitleInline}>
        Guides act as company admins on the companies they coach. They
        can&rsquo;t create or archive companies. Every guide must be
        assigned to at least one company.
      </p>

      {guides.length === 0 ? (
        <p className={styles.emptyLine}>No guides yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Guide</th>
              <th>Status</th>
              <th>Companies</th>
              <th>Assign To</th>
              <th className={styles.actionHead}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {guides.map((g) => {
              const pill = statusPill(g.status, g.invited_at);
              return (
                <tr key={g.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{g.full_name}</div>
                  </td>
                  <td>
                    <span className={pill.className} title={pill.title}>
                      {pill.label}
                    </span>
                  </td>
                  <td>
                    <GuideCompaniesCell
                      guideId={g.id}
                      assignments={g.assignments}
                    />
                  </td>
                  <td>
                    <GuideAssignCell
                      guideId={g.id}
                      assignments={g.assignments}
                      allCompanies={companies}
                    />
                  </td>
                  <td>
                    <GuideRowActions guideId={g.id} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: "var(--space-4)" }}>
        <h3 className={styles.h3}>Add a guide</h3>
        <CreateGuideForm companies={companies} />
      </div>
    </section>
  );
}
