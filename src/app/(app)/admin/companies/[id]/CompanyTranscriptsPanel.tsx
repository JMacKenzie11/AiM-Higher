import Link from "next/link";
import type {
  MeetingAdminRow,
  TranscriptAlias,
  TranscriptSource,
} from "@/lib/types";
import { ConnectCompanyFolderForm } from "./ConnectCompanyFolderForm";
import { ConnectGoogleButton } from "@/app/(app)/admin/transcripts/ConnectGoogleButton";
import { SourceRowActions } from "@/app/(app)/admin/transcripts/SourceRowActions";
import { AliasEditor } from "./AliasEditor";
import styles from "../admin.module.css";

// Per-company transcripts card. Each company connects its own
// Google account (0110) and points at its own Drive folders. Shows
// the connection state, folder sources, and recent meetings for
// this company. The unrouted queue lives on the overview page.

export function CompanyTranscriptsPanel({
  companyId,
  connectedAccount,
  sources,
  meetings,
  aliases,
  flashConnected,
  flashError,
}: {
  companyId: string;
  connectedAccount: string | null;
  sources: TranscriptSource[];
  meetings: MeetingAdminRow[];
  aliases: TranscriptAlias[];
  flashConnected: string | null;
  flashError: string | null;
}) {
  const meetingCountBySource = new Map<string, number>();
  for (const m of meetings) {
    meetingCountBySource.set(
      m.source_id,
      (meetingCountBySource.get(m.source_id) ?? 0) + 1
    );
  }

  return (
    <section className={styles.card} aria-labelledby="transcripts">
      <h2 id="transcripts" className={styles.h2}>
        Meeting transcripts
      </h2>

      {flashConnected ? (
        <p className={styles.successMessage} role="status">
          Connected as {flashConnected}.
        </p>
      ) : null}
      {flashError ? (
        <p className={styles.errorMessage} role="alert">
          Couldn&rsquo;t connect: {flashError}
        </p>
      ) : null}

      {!connectedAccount ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <p className={styles.subtitleInline}>
            Sign in with a Google account that has (or can be given) access to
            this company&rsquo;s transcript folders. Each company connects its
            own account, so folders can live under different Google Workspaces.
          </p>
          <div>
            <ConnectGoogleButton
              label="Connect Google account"
              href={`/api/oauth/google/start?company_id=${companyId}`}
            />
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            <p className={styles.subtitleInline}>
              Reading Drive as <strong>{connectedAccount}</strong>. Share each
              transcript folder with that address (Viewer), then connect it below.
            </p>
            <div>
              <ConnectGoogleButton
                label="Reconnect / switch account"
                href={`/api/oauth/google/start?company_id=${companyId}`}
              />
            </div>
          </div>

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
                        companyId={companyId}
                        status={s.status}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          <ConnectCompanyFolderForm companyId={companyId} />

          <div style={{ marginTop: "var(--space-4)" }}>
            <h3 className={styles.h3}>Transcript aliases</h3>
            <p className={styles.subtitleInline}>
              When a shared Drive folder serves multiple companies, transcript
              file names are matched (case-insensitive substring) against these
              aliases to decide who a meeting belongs to.
            </p>
            <AliasEditor companyId={companyId} aliases={aliases} />
          </div>

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
                            href={`/leadership/meetings/${m.id}`}
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
