import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import styles from "../../../../admin/companies/admin.module.css";
import transcriptStyles from "./transcript.module.css";

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

// "Name: words" lines get the name set apart, so a long transcript can
// be followed by who is speaking. Anything else is shown as it is.
function speakerOf(line: string): { speaker: string; words: string } | null {
  const m = /^([^:\n]{1,60}):\s+(.*)$/.exec(line);
  return m ? { speaker: m[1], words: m[2] } : null;
}

export default async function MeetingTranscriptPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, company_id, meeting_title, file_name, created_at, transcript_text")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      company_id: string | null;
      meeting_title: string | null;
      file_name: string;
      created_at: string;
      transcript_text: string | null;
    }>();
  if (!meeting) notFound();
  if (!meeting.company_id) redirect("/leadership");
  // The meeting page's check, for the same reason: RLS is the boundary,
  // and this avoids rendering a page for a row that slipped through.
  const callerCompanyId = await getEffectiveCompanyId(session);
  if (!isAdminForCompany(session.profile, meeting.company_id) && callerCompanyId !== meeting.company_id) {
    redirect("/leadership");
  }

  const lines = (meeting.transcript_text ?? "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const title = meeting.meeting_title ?? meeting.file_name;

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Meeting transcript">
        <div className={styles.heroInner}>
          <Link href={`/leadership/meetings/${meeting.id}`} className={styles.crumbLink}>
            ← Meeting analysis
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
          {lines.length === 0 ? (
            <p className={styles.emptyLine}>This meeting has no transcript.</p>
          ) : (
            <div className={transcriptStyles.transcript}>
              {lines.map((line, i) => {
                const turn = speakerOf(line);
                return (
                  <p key={i} className={transcriptStyles.line}>
                    {turn ? (
                      <>
                        <span className={transcriptStyles.speaker}>{turn.speaker}</span> {turn.words}
                      </>
                    ) : (
                      line
                    )}
                  </p>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
