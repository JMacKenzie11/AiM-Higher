import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Meeting } from "@/lib/types";
import styles from "../admin/companies/admin.module.css";

// Leadership — the home for meeting-transcript analyses.
//
// Every ingested meeting shows up here for the current scoped
// company: title, date, analysis status, and (when complete) a
// link into the full AI analysis + commitments the meeting spawned.
// Gated to system_admin / aims_guide / company_admin at the route
// level; RLS mirrors the check on the meetings + meeting_analyses
// tables.

export default async function LeadershipPage() {
  const session = await requireRole([
    "system_admin",
    "company_admin",
    "aims_guide",
  ]);
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("meetings")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(100);
  const meetings = (rows ?? []) as Meeting[];

  return (
    <div className={styles.stage}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Company</p>
          <h1 className={styles.h1}>Leadership</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Every meeting transcript this company has run through the
            analyzer, most recent first. Click a complete analysis to see
            the full write-up and the commitments it created.
          </p>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.card} aria-labelledby="meetings-list">
          <h2 id="meetings-list" className={styles.h2}>
            Meetings
          </h2>
          {meetings.length === 0 ? (
            <p className={styles.emptyLine}>
              No meetings analyzed yet. Connect a Drive folder from the
              company settings and drop a transcript in.
            </p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Meeting</th>
                  <th>Received</th>
                  <th>Status</th>
                  <th className={styles.actionHead}>Analysis</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => (
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
          )}
        </section>
      </div>
    </div>
  );
}
