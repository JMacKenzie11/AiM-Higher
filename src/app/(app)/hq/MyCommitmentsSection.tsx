import { CommitmentRow } from "../commitments/CommitmentRow";
import type { MyCommitmentRow } from "@/lib/hq/service";
import styles from "./hq.module.css";

// Cross-tenant "my commitments" view. Reuses the /commitments row
// exactly — same resolve mechanics, same undo chip, same reason
// prompts — with a company-name chip so the caller can tell which
// company each row lives in.
//
// Priority linking and reassign are disabled here: both would need
// per-company rosters and priorities that we don't fetch on this
// surface. Resolve, reschedule, and park are all available.
//
// On the read-only oversight view (/admin/guides/[id]/hq), the page
// passes readOnly=true which forces canResolve off.

export function MyCommitmentsSection({
  rows,
  currentUserId,
  todayIso,
  isAdmin,
  readOnly = false,
}: {
  rows: MyCommitmentRow[];
  currentUserId: string;
  todayIso: string;
  isAdmin: boolean;
  readOnly?: boolean;
}) {
  return (
    <section className={styles.card} aria-labelledby="hq-my-commitments">
      <h2 id="hq-my-commitments" className={styles.h2}>
        My commitments
      </h2>
      <p className={styles.sectionCaption}>
        Every commitment you own, across every company. Same resolve
        and reschedule mechanics as the Commitments page — the company
        chip on each row tells you which tenant the commitment lives in.
      </p>
      {rows.length === 0 ? (
        <p className={styles.empty}>
          You don&rsquo;t own any open commitments right now.
        </p>
      ) : (
        <div>
          {rows.map((row) => (
            <CommitmentRow
              key={row.id}
              commitment={row}
              priorityOptions={[]}
              roster={[]}
              todayIso={todayIso}
              canResolve={!readOnly}
              canLink={false}
              canReassign={false}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              companyLabel={row.companyName}
            />
          ))}
        </div>
      )}
    </section>
  );
}
