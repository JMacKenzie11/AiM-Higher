import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { transcriptSourcesAllowed } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Company, Meeting, TranscriptSource } from "@/lib/types";
import styles from "../companies/admin.module.css";
import { ConnectFolderForm } from "./ConnectFolderForm";
import { SourceRowActions } from "./SourceRowActions";
import { UnroutedRowActions } from "./UnroutedRowActions";

// System-admin transcripts surface: connected sources, connect flow,
// unrouted queue, recent meetings.

export default async function TranscriptsPage() {
  const session = await requireProfile();
  if (!transcriptSourcesAllowed(session.profile)) redirect("/");

  const supabase = await createSupabaseServerClient();
  const [{ data: sources }, { data: meetings }, { data: companies }] =
    await Promise.all([
      supabase
        .from("transcript_sources")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("meetings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("companies")
        .select("id, name")
        .eq("status", "active")
        .order("name"),
    ]);

  const sourceRows = (sources ?? []) as TranscriptSource[];
  const meetingRows = (meetings ?? []) as Meeting[];
  const companyRows = (companies ?? []) as Pick<Company, "id" | "name">[];
  const companyNameById = new Map(companyRows.map((c) => [c.id, c.name]));

  const unrouted = meetingRows.filter((m) => m.status === "unrouted");
  const recent = meetingRows.filter((m) => m.status !== "unrouted");

  // Per-source ingested count so the "processed" column has weight.
  const countBySource = new Map<string, number>();
  for (const m of meetingRows) {
    countBySource.set(m.source_id, (countBySource.get(m.source_id) ?? 0) + 1);
  }

  const serviceAccountEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ??
    "(GOOGLE_SERVICE_ACCOUNT_EMAIL not set)";

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Meeting transcripts">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>System</p>
          <h1 className={styles.h1}>Meeting Transcripts</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Connect Google Drive folders. New transcripts get analyzed,
            routed to the right company, and turned into commitments
            automatically.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.card} aria-labelledby="connect">
          <h2 id="connect" className={styles.h2}>
            Connect folder
          </h2>
          <p className={styles.subtitleInline}>
            Share your transcript folder with this address as Viewer, then
            paste the folder link below:
          </p>
          <CopyableEmail email={serviceAccountEmail} />
          <ConnectFolderForm companies={companyRows} />
        </section>

        <section className={styles.card} aria-labelledby="sources">
          <h2 id="sources" className={styles.h2}>
            Connected sources
          </h2>
          {sourceRows.length === 0 ? (
            <p className={styles.emptyLine}>No sources connected yet.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Folder</th>
                  <th>Scope</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Last checked</th>
                  <th className={styles.numHead}>Meetings</th>
                  <th className={styles.actionHead}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sourceRows.map((s) => (
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
                    <td className={styles.mutedCell}>
                      {s.company_id
                        ? companyNameById.get(s.company_id) ?? "(deleted)"
                        : "—"}
                    </td>
                    <td>
                      <StatusChip status={s.status} />
                    </td>
                    <td className={styles.mutedCell}>
                      {s.last_checked_at
                        ? new Date(s.last_checked_at).toLocaleString()
                        : "Never"}
                    </td>
                    <td className={`${styles.numCell} aims-tabular`}>
                      {countBySource.get(s.id) ?? 0}
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
          )}
        </section>

        <section className={styles.card} aria-labelledby="unrouted">
          <h2 id="unrouted" className={styles.h2}>
            Unrouted meetings
          </h2>
          {unrouted.length === 0 ? (
            <p className={styles.emptyLine}>
              Nothing waiting — every incoming file has been routed to a
              company via alias match, or delivered by a company-scoped
              source.
            </p>
          ) : (
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
                        companies={companyRows}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={styles.card} aria-labelledby="recent">
          <h2 id="recent" className={styles.h2}>
            Recent meetings
          </h2>
          {recent.length === 0 ? (
            <p className={styles.emptyLine}>Nothing analyzed yet.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Company</th>
                  <th>Received</th>
                  <th>Status</th>
                  <th className={styles.actionHead}>Analysis</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((m) => (
                  <tr key={m.id}>
                    <td>{m.meeting_title ?? m.file_name}</td>
                    <td className={styles.mutedCell}>
                      {m.company_id
                        ? companyNameById.get(m.company_id) ?? "(deleted)"
                        : "—"}
                    </td>
                    <td className={styles.mutedCell}>
                      {new Date(m.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <MeetingStatusChip status={m.status} error={m.error} />
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
          )}
        </section>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: TranscriptSource["status"] }) {
  const cls =
    status === "active"
      ? styles.chipActive
      : status === "paused"
        ? styles.chipInactive
        : styles.chipRevoked;
  return <span className={cls}>{status}</span>;
}

function MeetingStatusChip({
  status,
  error,
}: {
  status: Meeting["status"];
  error: string | null;
}) {
  const label = status === "failed" && error ? `failed (${error})` : status;
  const cls =
    status === "complete"
      ? styles.chipAccepted
      : status === "failed"
        ? styles.chipRevoked
        : styles.chipPending;
  return <span className={cls}>{label}</span>;
}

function CopyableEmail({ email }: { email: string }) {
  return (
    <code
      style={{
        display: "inline-block",
        padding: "4px 12px",
        background: "var(--aims-navy-tint)",
        borderRadius: "var(--radius-sm)",
        fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
        fontSize: "13px",
        userSelect: "all",
      }}
    >
      {email}
    </code>
  );
}
