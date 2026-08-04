import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { requireRole } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { FacilitationReview } from "@/components/leadership/FacilitationReview";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import type { FacilitationReview as FacilitationReviewData } from "@/lib/leadership/facilitation/types";
import type { Meeting, MeetingAnalysis, Profile } from "@/lib/types";
import styles from "../../../admin/companies/admin.module.css";

// Full meeting analysis + commitments the meeting spawned. Reached
// from /leadership. Gated to system_admin / company_admin / aims_guide
// via the requireRole at the top; isAdminForCompany then confirms
// the caller can act on this specific company (RLS on meetings +
// meeting_analyses mirrors the check).

type PageProps = { params: Promise<{ id: string }> };

export default async function MeetingAnalysisPage({ params }: PageProps) {
  const session = await requireRole([
    "system_admin",
    "company_admin",
    "aims_guide",
  ]);
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", id)
    .maybeSingle<Meeting>();
  if (!meeting) notFound();

  if (!meeting.company_id || !isAdminForCompany(session.profile, meeting.company_id)) {
    redirect("/leadership");
  }

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

  // Facilitation review only surfaces when the feature is on AND
  // the analysis row actually carries a review (older rows, or rows
  // analyzed while the flag was off, stay null and render nothing).
  const facilitationOn = await companyHasFeature(
    meeting.company_id,
    "meeting_facilitation_review"
  );
  const facilitationReview =
    facilitationOn && analysis?.facilitation_review_json
      ? (analysis.facilitation_review_json as FacilitationReviewData)
      : null;

  const commitmentRows = (commitments ?? []) as Array<{
    id: string;
    description: string;
    owner_id: string | null;
    due_date: string;
  }>;
  const ownerIds = Array.from(
    new Set(
      commitmentRows.map((c) => c.owner_id).filter((x): x is string => Boolean(x))
    )
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
          <Link href="/leadership" className={styles.crumbLink}>
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
        <div style={{ display: "flex" }}>
          <PrivacyNote tone="managerial">
            Meeting analyses and facilitation reviews are visible to system
            admins, company admins, and AiMS Guides for this company only.
            Meeting participants don&rsquo;t see this page.
          </PrivacyNote>
        </div>

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
                    {c.owner_id
                      ? rosterById.get(c.owner_id) ?? "Unknown"
                      : "Unassigned"}{" "}
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

        {facilitationReview ? (
          <FacilitationReview review={facilitationReview} />
        ) : null}
      </div>
    </div>
  );
}
