import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { FacilitationListChip } from "@/components/leadership/FacilitationReview";
import { PageShell } from "@/components/ui/PageShell";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import type { FacilitationReview } from "@/lib/leadership/facilitation/types";
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

  // Facilitation column is only fetched (and only rendered) when the
  // feature is on. One extra query for the complete-status meetings —
  // pending/failed rows can't have a review yet.
  const facilitationOn = await companyHasFeature(
    companyId,
    "meeting_facilitation_review"
  );
  const reviewByMeetingId = new Map<string, FacilitationReview>();
  if (facilitationOn) {
    const completeIds = meetings
      .filter((m) => m.status === "complete")
      .map((m) => m.id);
    if (completeIds.length > 0) {
      const { data: analysisRows } = await supabase
        .from("meeting_analyses")
        .select("meeting_id, facilitation_review_json")
        .in("meeting_id", completeIds);
      for (const row of (analysisRows ?? []) as Array<{
        meeting_id: string;
        facilitation_review_json: FacilitationReview | null;
      }>) {
        if (row.facilitation_review_json) {
          reviewByMeetingId.set(row.meeting_id, row.facilitation_review_json);
        }
      }
    }
  }

  return (
    <PageShell
      eyebrow="Company"
      title="Meetings"
      subtitle="Every meeting transcript this company has run through the analyzer, most recent first. Click a complete analysis to see the full write-up and the commitments it created."
    >
      <div style={{ display: "flex" }}>
        <PrivacyNote tone="managerial">
          Meeting transcripts, analyses, and facilitation reviews on this
          page are visible to system admins, company admins, and AiMS
          Guides for this company only. Meeting participants don&rsquo;t
          see this list.
        </PrivacyNote>
      </div>

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
                  {facilitationOn ? <th>Facilitation</th> : null}
                  <th className={styles.actionHead}>Analysis</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => {
                  const review = reviewByMeetingId.get(m.id);
                  return (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600 }}>
                        {m.meeting_title ?? m.file_name}
                      </td>
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
                      {facilitationOn ? (
                        <td>
                          {review ? (
                            <FacilitationListChip review={review} />
                          ) : (
                            <span className={styles.mutedCell}>—</span>
                          )}
                        </td>
                      ) : null}
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
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
    </PageShell>
  );
}
