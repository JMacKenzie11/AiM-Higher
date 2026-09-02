import type { Company, MeetingListRow } from "@/lib/types";
import { UnroutedRowActions } from "@/app/(app)/admin/transcripts/UnroutedRowActions";
import styles from "./admin.module.css";

// Platform-level transcripts panel. Under per-company OAuth (0110)
// the Google account connection lives on each company's page — the
// only cross-company thing left is the unrouted queue, which
// existed to catch shared-folder ingests. If there's nothing
// unrouted, the panel doesn't render at all.

export function PlatformTranscriptsPanel({
  unrouted,
  companies,
}: {
  unrouted: MeetingListRow[];
  companies: Pick<Company, "id" | "name">[];
}) {
  if (unrouted.length === 0) return null;

  return (
    <section className={styles.card} aria-labelledby="unrouted-meetings">
      <h2 id="unrouted-meetings" className={styles.h2}>
        Unrouted meetings
      </h2>
      <p className={styles.subtitleInline}>
        The filename didn&rsquo;t match a single company&rsquo;s aliases.
        Pick a company below to route + analyze.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>File</th>
            <th>Received</th>
            <th className={styles.actionHead}>Route to company</th>
          </tr>
        </thead>
        <tbody>
          {unrouted.map((m) => (
            <tr key={m.id}>
              <td>{m.file_name}</td>
              <td className={styles.mutedCell}>
                {new Date(m.created_at).toLocaleDateString()}
              </td>
              <td>
                <UnroutedRowActions
                  meetingId={m.id}
                  companies={companies}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
