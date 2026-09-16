import type { Company, Profile } from "@/lib/types";
import type { GuideOverviewRow } from "@/lib/admin/guides-service";
import { AssignSysadminForm } from "./AssignSysadminForm";
import { CreateGuideForm } from "./CreateGuideForm";
import { GuideRowActions } from "./GuideRowActions";
import styles from "./admin.module.css";
import { CompanyAccessRows } from "@/components/access/CompanyAccessRows";
import { setGuideCompanyAccessAction } from "@/lib/admin/guides-actions";

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
  sysadminCandidates,
}: {
  guides: GuideOverviewRow[];
  companies: Pick<Company, "id" | "name">[];
  sysadminCandidates: Pick<Profile, "id" | "full_name">[];
}) {
  return (
    <section className={styles.card} aria-labelledby="aims-guides">
      <h2 id="aims-guides" className={styles.h2}>
        AiMS Guides
      </h2>
      <p className={styles.subtitleInline}>
        Guides act as company admins on the companies they coach. System
        admins can also carry a coaching caseload — their row appears
        here once they&rsquo;re assigned to at least one company.
      </p>

      {/* THE SAME CARD THE PORTFOLIO ADMINS GET, and for the same
          reason: a guide and a portfolio admin are the same question
          asked twice — a person with no company of their own holding
          rights in a list of companies. This was a table with a chip
          list, a separate "Assign To" picker and two columns that
          rendered a dash, which is three controls for one idea.
          Now: tick, untick, Update.

          The account actions that lived in the old Actions column
          (resend invite, copy link, delete) ride along on each row.
          They were never dead — they are hidden for a system admin
          carrying a caseload, which is who the only visible row
          belonged to. */}
      <CompanyAccessRows
        rows={guides.map((g) => {
          const isSysadmin = g.role === "system_admin";
          const pill = statusPill(g.status, g.invited_at);
          return {
            id: g.id,
            name: g.full_name,
            companyIds: g.assignments.map((a) => a.company_id),
            openCommitmentsByCompany: g.openCommitmentsByCompany,
            detail: (
              <span
                className={isSysadmin ? styles.chipActive : pill.className}
                title={isSysadmin ? "Active" : pill.title}
              >
                {isSysadmin ? "System admin · Active" : pill.label}
              </span>
            ),
            actions: (
              <GuideRowActions guideId={g.id} canManageAccount={!isSysadmin} />
            ),
          };
        })}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        action={setGuideCompanyAccessAction}
        personLabel="Guide"
        emptyLabel="No guides yet."
      />

      <div style={{ marginTop: "var(--space-4)" }}>
        <h3 className={styles.h3}>Add a guide</h3>
        <CreateGuideForm companies={companies} />
      </div>

      <div style={{ marginTop: "var(--space-4)" }}>
        <h3 className={styles.h3}>Give a system admin a coaching caseload</h3>
        <p className={styles.subtitleInline}>
          Existing system-admin accounts only. No invite is sent —
          they already have platform access. Removing an assignment
          later never reduces the sysadmin&rsquo;s access to that
          company; it&rsquo;s just a caseload marker.
        </p>
        <AssignSysadminForm
          sysadmins={sysadminCandidates}
          companies={companies}
        />
        {sysadminCandidates.length === 0 ? (
          <p className={styles.emptyLine}>
            No system-admin accounts to assign.
          </p>
        ) : null}
      </div>
    </section>
  );
}
