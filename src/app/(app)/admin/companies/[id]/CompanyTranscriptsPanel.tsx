import Link from "next/link";
import type { Meeting, TranscriptSource } from "@/lib/types";
import { CardAccent } from "@/components/ui/CardAccent";
import { ConnectCompanyFolderForm } from "./ConnectCompanyFolderForm";
import { SourceRowActions } from "@/app/(app)/admin/transcripts/SourceRowActions";
import styles from "../admin.module.css";

// Per-company transcripts card. Shows only the sources connected to
// this company (or a shared source that's routed a meeting here),
// plus recent meetings for this company, plus a scoped connect
// folder form. The Google account connection and unrouted queue
// live on the overview page — this card assumes both are handled.

export function CompanyTranscriptsPanel({
  companyId,
  connectedAccount,
  sources,
  meetings,
}: {
  companyId: string;
  connectedAccount: string | null;
  sources: TranscriptSource[];
  meetings: Meeting[];
}) {
  const meetingCountBySource = new Map<string, number>();
  for (const m of meetings) {
    meetingCountBySource.set(
      m.source_id,
      (meetingCountBySource.get(m.source_id) ?? 0) + 1
    );
  }

  return (
    <section className={styles.cardAccent} aria-labelledby="transcripts">
      <CardAccent />
      <h2 id="transcripts" className={styles.h2}>
        Meeting transcripts
      </h2>

      {!connectedAccount ? (
        <p className={styles.emptyLine}>
          Connect a Google account on the{" "}
          <Link href="/admin/companies" className={styles.crumbLink}>
            Companies
          </Link>{" "}
          overview page before adding transcript folders.
        </p>
      ) : (
        <>
          <p className={styles.subtitleInline}>
            Drive folders shared with <strong>{connectedAccount}</strong> and
            connected here will feed this company&rsquo;s commitments and
            leadership analyses.
          </p>

          {sources.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Folder</th>
                  <th>Scope</th>
                  <th>Status</th>
                  <th>Last checked</th>
                  <th className={styles.numHead}>Meetings</th>
                  <th className={styles.actionHead}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {s.folder_name ?? "(unnamed)"}
                      </div>
                      {s.last_error ? (
                        <div className={styles.inlineError}>{s.last_error}</div>
                      ) : null}
                    </td>
                    <td className={styles.capCell}>{s.scope}</td>
                    <td>
                      <span
                        className={
                          s.status === "active"
                            ? styles.chipActive
                            : s.status === "paused"
                              ? styles.chipInactive
                              : styles.chipRevoked
                        }
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className={styles.mutedCell}>
                      {s.last_checked_at
                        ? new Date(s.last_checked_at).toLocaleString()
                        : "Never"}
                    </td>
                    <td className={`${styles.numCell} aims-tabular`}>
                      {meetingCountBySource.get(s.id) ?? 0}
                    </td>
                    <td>
                      <SourceRowActions
                        sourceId={s.id}
                        status={s.status}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          <ConnectCompanyFolderForm companyId={companyId} />

          {meetings.length > 0 ? (
            <div style={{ marginTop: "var(--space-4)" }}>
              <h3 className={styles.h3}>Recent meetings</h3>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Received</th>
                    <th>Status</th>
                    <th className={styles.actionHead}>Analysis</th>
                  </tr>
                </thead>
                <tbody>
                  {meetings.slice(0, 20).map((m) => (
                    <tr key={m.id}>
                      <td>{m.meeting_title ?? m.file_name}</td>
                      <td className={styles.mutedCell}>
                        {new Date(m.created_at).toLocaleDateString()}
                      </td>
                      <td>
                        <span
                          className={
                            m.status === "complete"
                              ? styles.chipAccepted
                              : m.status === "failed"
                                ? styles.chipRevoked
                                : styles.chipPending
                          }
                        >
                          {m.status === "failed" && m.error
                            ? `failed (${m.error})`
                            : m.status}
                        </span>
                      </td>
                      <td>
                        {m.status === "complete" ? (
                          <Link
                            href={`/admin/transcripts/meetings/${m.id}`}
                            className={styles.ghostButton}
                          >
                            View
                          </Link>
                        ) : (
                          <span className={styles.mutedCell}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
