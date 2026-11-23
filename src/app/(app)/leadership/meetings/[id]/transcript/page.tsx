import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import styles from "../../../../admin/companies/admin.module.css";
import transcriptStyles from "./transcript.module.css";
import { turnsOf } from "@/lib/transcripts/turns";
import { canReadCoachingCalls } from "@/lib/coaching-calls/access";

export const metadata = { title: "Meeting transcript" };

// A MEETING'S TRANSCRIPT, for everyone in the company (Jason,
// 2026-10-01; phase D of docs/investigations/open-data.md). Company
// content is open to the company, and the transcript is the meeting
// itself. Nothing showed it before, to anyone: the row's read rule
// already admitted the company's people, and no page selected it.
//
// Its own page rather than a tab: a transcript runs to 40,000 to
// 70,000 characters, and the meeting page should not carry that for
// people who came for the summary. Read through the caller's own
// session, so the read rule decides, with the same company check as
// the meeting page.

type PageProps = { params: Promise<{ id: string }> };

export default async function MeetingTranscriptPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  // meetings-kind: either kind, on the caller's own client. A coaching
  // call reaches only the people who can see the company's coaching
  // calls (0326, 0329), and is asked
  // again below before its transcript is shown.
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, company_id, meeting_title, file_name, created_at, transcript_text, kind")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      company_id: string | null;
      meeting_title: string | null;
      file_name: string;
      created_at: string;
      transcript_text: string | null;
      kind?: "team" | "coaching";
    }>();
  if (!meeting) notFound();
  if (!meeting.company_id) redirect("/leadership");
  const coaching = meeting.kind === "coaching";
  if (coaching && !(await canReadCoachingCalls(meeting.company_id))) notFound();
  // The meeting page's check, for the same reason: RLS is the boundary,
  // and this avoids rendering a page for a row that slipped through.
  const callerCompanyId = await getEffectiveCompanyId(session);
  if (!isAdminForCompany(session.profile, meeting.company_id) && callerCompanyId !== meeting.company_id) {
    redirect("/leadership");
  }

  const turns = turnsOf(meeting.transcript_text ?? "");
  const title = meeting.meeting_title ?? meeting.file_name;

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Meeting transcript">
        <div className={styles.heroInner}>
          <Link href={`/leadership/meetings/${meeting.id}`} className={styles.crumbLink}>
            {coaching ? "← Coaching call analysis" : "← Meeting analysis"}
          </Link>
          <p className={styles.eyebrow}>Transcript</p>
          <h1 className={styles.h1}>{title}</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            {new Date(meeting.created_at).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      </section>
      <div className={styles.content}>
        <section className={styles.card} aria-label="Transcript">
          {turns.length === 0 ? (
            <p className={styles.emptyLine}>This meeting has no transcript.</p>
          ) : (
            <div className={transcriptStyles.transcript}>
              {turns.map((turn, i) => (
                <p key={i} className={transcriptStyles.line}>
                  {turn.speaker ? (
                    <>
                      <span className={transcriptStyles.speaker}>{turn.speaker}</span> {turn.words}
                    </>
                  ) : (
                    turn.words
                  )}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
