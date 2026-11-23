import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { FacilitationListChip } from "@/components/leadership/FacilitationReview";
import type { StoredScoreRow } from "@/lib/leadership/facilitation/score";
import { isShowableReview } from "@/lib/leadership/facilitation/scored";
import { PageShell } from "@/components/ui/PageShell";
import type { FacilitationReview } from "@/lib/leadership/facilitation/types";
import type { MeetingListRow } from "@/lib/types";
import styles from "../admin/companies/admin.module.css";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { simplifyOn } from "@/lib/ui/simplify";
import {
  canManageCompanyMeetings,
  canRetryFailedMeeting,
} from "@/lib/transcripts/retry";
import { RetryFailedMeetingButton } from "./RetryFailedMeetingButton";
import { UploadTranscriptForm } from "./UploadTranscriptForm";
import { ymdIn } from "@/lib/transcripts/upload";
import {
  canManageCoachingCallAccess,
  canReadCoachingCalls,
  coachingCallReaders,
} from "@/lib/coaching-calls/access";
import { CoachingCallAccess } from "./CoachingCallAccess";
import { coachingReadersLine } from "@/lib/transcripts/coaching";
import { AnalysisTabs } from "./meetings/[id]/AnalysisTabs";
import type { ReactNode } from "react";

export const metadata = { title: "Meeting Summaries" };

// Upload a transcript runs the analysis after the response (after()),
// inside this route's function. A meeting analysis takes two to four
// minutes.
export const maxDuration = 300;

// Leadership — the home for meeting-transcript analyses.
//
// Every ingested meeting shows up here for the current scoped
// company: title, date, analysis status, and (when complete) a
// link into the full AI analysis + commitments the meeting spawned.
// Open to every same-company member, facilitation scores included:
// everyone in a company reads its content (0253, phase D of
// docs/investigations/open-data.md). This file selects only metadata
// columns; the transcript has its own page.
//
// COACHING CALLS (0326, 0329). The company's assigned coaches, its
// admins and the people they have added see a second tab, Coaching
// calls, listing the coach's calls with the company's leaders. Everyone
// else gets the page exactly as before, with no tab and no hint of
// one. The tab is decided by can_read_coaching_call(), the function the
// read rule itself calls, and the Team meetings list asks for kind =
// 'team' by name, so a coaching call never shows among the team's
// meetings. A coach or admin manages who else sees them from the tab
// (Manage access).

export default async function LeadershipPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  // Explicit column list, NOT select("*"). The Meeting row carries
  // transcript_text (the full meeting transcript); selecting it for
  // 100 rows pulled megabytes over the wire and through JSON.parse to
  // render a table of titles and dates. These six columns are exactly
  // what the table below reads.
  const { data: rows } = await supabase
    .from("meetings")
    .select("id, meeting_title, file_name, status, error, created_at")
    .eq("company_id", companyId)
    .eq("kind", "team")
    .order("created_at", { ascending: false })
    .limit(100);
  const meetings = (rows ?? []) as MeetingListRow[];
  // Try again on a failed row: the people who manage this company's
  // meetings (system admin, its company admin, an assigned guide).
  // retryFailedMeetingAction checks the same rule.
  const canRetry = canManageCompanyMeetings(session.profile, companyId);
  // Upload a transcript: the same people. uploadTranscriptAction checks
  // the same rule.
  const canUpload = canRetry;
  let today = ymdIn(new Date(), "UTC");
  if (canUpload) {
    const { data: co } = await supabase
      .from("companies")
      .select("timezone")
      .eq("id", companyId)
      .maybeSingle<{ timezone: string | null }>();
    today = ymdIn(new Date(), co?.timezone || "UTC");
  }

  // Facilitation column is fetched and rendered when the feature is
  // on, for everyone in the company (Jason, 2026-10-01: company content
  // is open to the company, the review included). One extra query for
  // the complete-status meetings; pending or failed rows can't have a
  // review yet.
  const facilitationFeatureOn = await companyHasFeature(
    companyId,
    "meeting_facilitation_review"
  );
  const facilitationOn = facilitationFeatureOn;
  const reviewByMeetingId = new Map<string, FacilitationReview>();
  const scoreRowByMeetingId = new Map<string, StoredScoreRow>();
  if (facilitationOn) {
    const completeIds = meetings
      .filter((m) => m.status === "complete")
      .map((m) => m.id);
    if (completeIds.length > 0) {
      // meetings-kind: ids from the team-only list above.
      const { data: analysisRows } = await supabase
        .from("meeting_analyses")
        .select(
          "meeting_id, created_at, facilitation_review_json, score_positive_framing, score_rhythm, score_accountability, score_alignment, score_agenda, score_weights"
        )
        .in("meeting_id", completeIds);
      for (const row of (analysisRows ?? []) as Array<{
        meeting_id: string;
        facilitation_review_json: FacilitationReview | null;
        created_at: string;
        score_positive_framing: number | null;
        score_rhythm: number | null;
        score_accountability: number | null;
        score_alignment: number | null;
        score_agenda: number | null;
        score_weights: unknown;
      }>) {
        // The same parts the detail page reads, so the chip and the
        // page show the same number.
        scoreRowByMeetingId.set(row.meeting_id, row);
        // isShowableReview, so this list and the meeting detail page
        // agree about whether a review exists. They disagreed for
        // meeting 4d235cd3: a stored review with every score null
        // rendered a card on the detail page and an empty cell here.
        if (
          row.facilitation_review_json &&
          isShowableReview(row.facilitation_review_json)
        ) {
          reviewByMeetingId.set(row.meeting_id, row.facilitation_review_json);
        }
      }
    }
  }

  const subtitle =
    // One line under the "short-intros" switch (change 10).
    simplifyOn("short-intros")
      ? "Every analysed meeting, newest first."
      : "Every meeting transcript this company has run through the analyzer, most recent first. Click a complete analysis to see the full write-up and the commitments it created.";

  const teamMeetings = (
    <>
      {canUpload ? (
        <section className={styles.card} aria-labelledby="upload-transcript">
          <h2 id="upload-transcript" className={styles.h2}>
            Upload a transcript
          </h2>
          <UploadTranscriptForm today={today} />
        </section>
      ) : null}
      <section className={styles.card} aria-labelledby="meetings-list">
          <h2 id="meetings-list" className={styles.h2}>
            Meetings
          </h2>
          {meetings.length === 0 ? (
            <p className={styles.emptyLine}>
              No meetings analyzed yet. Upload a transcript, or connect
              a Drive folder or Teams meeting from the company settings.
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
                            <FacilitationListChip
                              review={review}
                              row={scoreRowByMeetingId.get(m.id) ?? null}
                            />
                          ) : (
                            <span className={styles.mutedCell}>—</span>
                          )}
                        </td>
                      ) : null}
                      <td>
                        {m.status === "complete" ? (
                          <Link
                            href={`/leadership/meetings/${m.id}`}
                            className={`${styles.ghostButton}`}
                          >
                            View
                          </Link>
                        ) : canRetry && canRetryFailedMeeting(m) ? (
                          <RetryFailedMeetingButton meetingId={m.id} />
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
    </>
  );

  // Everyone who cannot see the company's coaching calls gets the page
  // exactly as it was: no tab, no hint of one.
  if (!(await canReadCoachingCalls(companyId))) {
    return (
      <PageShell eyebrow="Company" title="Meeting Summaries" subtitle={subtitle}>
        {teamMeetings}
      </PageShell>
    );
  }

  return (
    <PageShell eyebrow="Company" title="Meeting Summaries" subtitle={subtitle} flush>
      <AnalysisTabs
        label="Meeting Summaries"
        tabs={[
          { hash: "team-meetings", label: "Team meetings", content: teamMeetings },
          {
            hash: "coaching-calls",
            label: "Coaching calls",
            icon: <LockIcon />,
            content: await coachingCallsTab({ companyId, today, canRetry, supabase }),
          },
        ]}
      />
    </PageShell>
  );
}

// ---- The Coaching calls tab (0326) ---------------------------------
//
// Only reached by someone who can see the company's coaching calls
// (canReadCoachingCalls above). Read through the caller's own client,
// so the read rule decides as well: kind = 'coaching' rows reach those
// people and nobody else.
async function coachingCallsTab({
  companyId,
  today,
  canRetry,
  supabase,
}: {
  companyId: string;
  today: string;
  canRetry: boolean;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}): Promise<ReactNode> {
  const [{ data: rows }, readers, canManage] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, meeting_title, file_name, status, error, created_at")
      .eq("company_id", companyId)
      .eq("kind", "coaching")
      .order("created_at", { ascending: false })
      .limit(100),
    coachingCallReaders(companyId),
    canManageCoachingCallAccess(companyId),
  ]);
  const calls = (rows ?? []) as MeetingListRow[];
  // Who a coach or admin can add: the company's active people who don't
  // already see the calls. Company admins see them anyway, so they are
  // never offered. Read on the caller's own client.
  let candidates: Array<{ id: string; name: string }> = [];
  if (canManage) {
    const listed = new Set(readers.viewers.map((v) => v.profileId));
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("company_id", companyId)
      .eq("status", "active")
      .neq("role", "company_admin")
      .order("full_name", { ascending: true });
    candidates = ((people ?? []) as Array<{ id: string; full_name: string | null; role: string }>)
      .filter((p) => !listed.has(p.id) && (p.full_name ?? "").trim() !== "")
      .map((p) => ({ id: p.id, name: (p.full_name ?? "").trim() }));
  }
  return (
    <>
      <CoachingCallAccess
        line={`${coachingReadersLine(readers, "these calls")} Aimee does not read them, and nothing here goes on the company's lists.`}
        canManage={canManage}
        coaches={readers.coaches}
        admins={readers.admins}
        viewers={readers.viewers}
        candidates={candidates}
      />
      <section className={styles.card} aria-labelledby="add-coaching-call">
        <h2 id="add-coaching-call" className={styles.h2}>
          Add a coaching call
        </h2>
        <UploadTranscriptForm today={today} kind="coaching" />
      </section>
      <section className={styles.card} aria-labelledby="coaching-calls-list">
        <h2 id="coaching-calls-list" className={styles.h2}>
          Calls
        </h2>
        {calls.length === 0 ? (
          <p className={styles.emptyLine}>
            No coaching calls yet. Add one above.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Call</th>
                <th>Held on</th>
                <th>Status</th>
                <th className={styles.actionHead}>Analysis</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.meeting_title ?? m.file_name}</td>
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
                      {m.status === "failed" && m.error ? `failed (${m.error})` : m.status}
                    </span>
                  </td>
                  <td>
                    {m.status === "complete" ? (
                      <Link href={`/leadership/meetings/${m.id}`} className={styles.ghostButton}>
                        View
                      </Link>
                    ) : canRetry && canRetryFailedMeeting(m) ? (
                      <RetryFailedMeetingButton meetingId={m.id} />
                    ) : (
                      <span className={styles.mutedCell}>Not ready</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
