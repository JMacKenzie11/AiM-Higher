"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createProposalAction } from "@/lib/diagnostics/proposal-actions";
import { PROPOSAL_STATUS_LABEL, proposalStatus, type ProposalRow, type ProposalStatus } from "@/lib/diagnostics/proposals";
import { useDxAction } from "../../useDxAction";
import { shortDate } from "../../format";
import styles from "../../diagnostics.module.css";

// A client's proposals (0312): each series at its newest version, where
// it stands, and New proposal. The owner signs with the login for the
// owner email on the client, so the card says when there is none.

const TONE: Record<ProposalStatus, string> = {
  draft: styles.chipMuted,
  waiting: styles.chipWarn,
  signed: "",
  replaced: styles.chipMuted,
};

export function Proposals({
  clientId,
  proposals,
  ownerEmail,
  ownerHasLogin,
  archived,
}: {
  clientId: string;
  proposals: ProposalRow[];
  ownerEmail: string | null;
  ownerHasLogin: boolean;
  archived: boolean;
}) {
  const router = useRouter();
  const { pending, error, run } = useDxAction();
  // One row per series: its newest version.
  const latest = new Map<string, ProposalRow>();
  for (const p of proposals) {
    const seen = latest.get(p.series_id);
    if (!seen || p.version > seen.version) latest.set(p.series_id, p);
  }
  const rows = [...latest.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <section className={styles.card} aria-labelledby="client-proposals">
      <div className={styles.cardHeader}>
        <h2 id="client-proposals" className={styles.cardTitle}>
          Proposals
        </h2>
        <span className={styles.cardMeta}>{rows.length}</span>
        {archived ? null : (
          <span className={styles.headerAction}>
            <button
              type="button"
              className={`${styles.secondary} ${styles.small}`}
              disabled={pending}
              onClick={() => run(() => createProposalAction(clientId), (r) => r.id && router.push(`/diagnostics/proposals/${r.id}`))}
            >
              New proposal
            </button>
          </span>
        )}
      </div>
      {!ownerEmail ? (
        <p className={`${styles.warnText} ${styles.cardLead}`}>Add the owner&rsquo;s email under Details. The owner signs with the login for that email.</p>
      ) : !ownerHasLogin ? (
        <p className={`${styles.warnText} ${styles.cardLead}`}>
          The owner has no login yet. Invite {ownerEmail} under People who can sign in, so they can sign.
        </p>
      ) : null}
      {error ? (
        <p className={`${styles.error} ${styles.cardLead}`} role="alert">
          {error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className={styles.empty}>None yet.</p>
      ) : (
        <ul className={styles.plainList}>
          {rows.map((p) => {
            const status = proposalStatus(p);
            return (
              <li key={p.id}>
                <Link href={`/diagnostics/proposals/${p.id}`} className={styles.link}>
                  {p.title}, version {p.version}
                </Link>
                <span className={styles.formRow}>
                  <span className={styles.muted}>
                    {status === "signed" && p.client_signed_at
                      ? `Signed ${shortDate(p.client_signed_at)}`
                      : p.published_at
                        ? `Published ${shortDate(p.published_at)}`
                        : `Started ${shortDate(p.created_at)}`}
                  </span>
                  <span className={`${styles.chip} ${TONE[status]}`}>{PROPOSAL_STATUS_LABEL[status]}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
