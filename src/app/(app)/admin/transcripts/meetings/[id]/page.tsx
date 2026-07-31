import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Meeting, MeetingAnalysis, Profile } from "@/lib/types";
import styles from "../../../companies/admin.module.css";

// Meeting analysis viewer. Visible to system_admin and to
// company_admin of the routed company (RLS enforces).

type PageProps = { params: Promise<{ id: string }> };

export default async function MeetingAnalysisPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", id)
    .maybeSingle<Meeting>();
  if (!meeting) notFound();

  const isSystemAdmin = session.profile.role === "system_admin";
  const isRoutedCompanyAdmin =
    session.profile.role === "company_admin" &&
    meeting.company_id === session.profile.company_id;
  if (!isSystemAdmin && !isRoutedCompanyAdmin) redirect("/");

  const [{ data: analysis }, { data: commitments }] = await Promise.all([
    supabase
      .from("meeting_analyses")
      .select("*")
      .eq("meeting_id", id)
      .maybeSingle<MeetingAnalysis>(),
    supabase
      .from("commitments")
      .select("id, description, owner_id, due_date")
      .eq("source_meeting_id", id),
  ]);

  const commitmentRows = (commitments ?? []) as Array<{
    id: string;
    description: string;
    owner_id: string | null;
    due_date: string;
  }>;
  const ownerIds = Array.from(
    new Set(commitmentRows.map((c) => c.owner_id).filter((x): x is string => Boolean(x)))
  );
  const rosterById = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ownerIds);
    for (const p of (profiles ?? []) as Pick<Profile, "id" | "full_name">[]) {
      rosterById.set(p.id, p.full_name);
    }
  }

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Meeting analysis">
        <div className={styles.heroInner}>
          <Link href="/admin/transcripts" className={styles.crumbLink}>
            ← All meetings
          </Link>
          <p className={styles.eyebrow}>Meeting analysis</p>
          <h1 className={styles.h1}>
            {meeting.meeting_title ?? meeting.file_name}
          </h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            {new Date(meeting.created_at).toLocaleString()} ·{" "}
            {commitmentRows.length} commitment
            {commitmentRows.length === 1 ? "" : "s"} created
          </p>
        </div>
      </section>

      <div className={styles.content}>
        {commitmentRows.length > 0 ? (
          <section className={styles.card} aria-labelledby="cmt">
            <h2 id="cmt" className={styles.h2}>
              Commitments created
            </h2>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {commitmentRows.map((c) => (
                <li
                  key={c.id}
                  style={{
                    padding: "var(--space-3) 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{c.description}</div>
                  <div className={styles.mutedCell}>
                    {c.owner_id ? rosterById.get(c.owner_id) ?? "Unknown" : "Unassigned"}{" "}
                    · Due {c.due_date}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={styles.card} aria-labelledby="analysis">
          <h2 id="analysis" className={styles.h2}>
            Analysis
          </h2>
          {analysis?.analysis_markdown ? (
            <div className="aims-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {analysis.analysis_markdown}
              </ReactMarkdown>
            </div>
          ) : (
            <p className={styles.emptyLine}>Analysis not available.</p>
          )}
        </section>
      </div>
    </div>
  );
}
