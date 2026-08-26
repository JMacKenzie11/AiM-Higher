import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { FacilitationReview } from "@/components/leadership/FacilitationReview";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import { RerunFacilitationButton } from "./RerunFacilitationButton";
import { ReanalyzeMeetingButton } from "./ReanalyzeMeetingButton";
import type { FacilitationReview as FacilitationReviewData } from "@/lib/leadership/facilitation/types";
import type {
  ExtractedCommitment,
  ExtractedIssue,
  Meeting,
  MeetingAnalysis,
  Priority,
  Profile,
} from "@/lib/types";
import { findSimilarOpenItem } from "@/lib/transcripts/similarity";
import { getCurrentQuarter } from "@/lib/quarters/service";
import {
  ExtractedIssuesSection,
  type ExtractedIssueRow,
} from "./ExtractedIssuesSection";
import {
  ExtractedCommitmentsSection,
  type ExtractedCommitmentRow,
} from "./ExtractedCommitmentsSection";
import styles from "../../../admin/companies/admin.module.css";

// Full meeting analysis + commitments the meeting spawned. Reached
// from /leadership. Open to every same-company member; RLS on
// meetings + meeting_analyses admits authenticated users whose
// profile.company_id matches. Facilitation review + rerun button
// stay admin-gated in the render below (grades the meeting leader —
// wrong default to share with the person being graded).

type PageProps = { params: Promise<{ id: string }> };

export default async function MeetingAnalysisPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, company_id, meeting_title, file_name, status, error, created_at")
    .eq("id", id)
    .maybeSingle<Pick<Meeting, "id" | "company_id" | "meeting_title" | "file_name" | "status" | "error" | "created_at">>();
  if (!meeting) notFound();

  // Unrouted meetings (no company yet) have no leadership home —
  // they're only reachable from the sysadmin routing surface.
  if (!meeting.company_id) redirect("/leadership");
  const isAdmin = isAdminForCompany(session.profile, meeting.company_id);
  // Same-company gate: a team_member in company A can't read
  // meetings routed to company B. RLS also enforces this; the
  // check below just avoids rendering a broken page if the row
  // somehow slipped through. Admins for the company (sysadmin,
  // company_admin scoped in, assigned guide) are covered by
  // isAdminForCompany semantics.
  const callerCompanyId = await getEffectiveCompanyId(session);
  if (!isAdmin && callerCompanyId !== meeting.company_id) {
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

  // Facilitation review only surfaces when the feature is on, the
  // caller can manage this company, AND the analysis row actually
  // carries a review (older rows, or rows analyzed while the flag
  // was off, stay null and render nothing). Non-admins never see
  // the review — it grades the meeting leader, and that's not the
  // right shared artefact for participants.
  const facilitationFeatureOn = await companyHasFeature(
    meeting.company_id,
    "meeting_facilitation_review"
  );
  const facilitationOn = facilitationFeatureOn && isAdmin;
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
  // Owners referenced by BOTH the created-commitments list and the
  // extracted-commitments list get fetched in one round-trip.
  const extractedCommitments =
    (analysis?.commitments_json ?? []) as ExtractedCommitment[];
  const extractedIssues = (analysis?.issues_json ?? []) as ExtractedIssue[];
  // automated_commitment_tracking is an app-level feature flag
  // (see src/lib/companies/features.ts) not a ModuleFeature, so we
  // hit company_features directly rather than through
  // companyHasFeature. Present + true = on.
  const { data: autoTrackRow } = await supabase
    .from("company_features")
    .select("feature")
    .eq("company_id", meeting.company_id)
    .eq("feature", "automated_commitment_tracking")
    .maybeSingle<{ feature: string }>();
  const autoTrackOn = Boolean(autoTrackRow);
  const ownerIds = Array.from(
    new Set(
      [
        ...commitmentRows.map((c) => c.owner_id),
        ...extractedCommitments.map((c) => c.owner_profile_id),
      ].filter((x): x is string => Boolean(x))
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

  // Precompute the "already added" state for extracted items so
  // the client rows render with the correct done-state on first
  // paint (no client fetch, no flicker).
  const [alreadyAddedIssues, alreadyAddedCommitments] = await Promise.all([
    extractedIssues.length > 0
      ? supabase
          .from("issues")
          .select("title")
          .eq("source_meeting_id", meeting.id)
      : Promise.resolve({ data: [] as Array<{ title: string }> }),
    extractedCommitments.length > 0
      ? supabase
          .from("commitments")
          .select("description")
          .eq("source_meeting_id", meeting.id)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as Array<{ description: string }> }),
  ]);
  const addedIssueTitles = new Set(
    ((alreadyAddedIssues.data ?? []) as Array<{ title: string }>).map(
      (r) => r.title
    )
  );
  const addedCommitmentDescriptions = new Set(
    (
      (alreadyAddedCommitments.data ?? []) as Array<{ description: string }>
    ).map((r) => r.description)
  );

  // Duplicate awareness — for each extracted item, find a similar
  // open commitment / issue created in the last 14 days. Read-only
  // signal; the "Add" action stays available regardless.
  const companyId = meeting.company_id;
  const issueRows: ExtractedIssueRow[] = await Promise.all(
    extractedIssues.map(async (issue) => ({
      issue,
      alreadyAdded: addedIssueTitles.has(issue.title),
      similar: await findSimilarOpenItem(companyId, issue.title),
    }))
  );
  const commitmentExtractionRows: ExtractedCommitmentRow[] = await Promise.all(
    extractedCommitments.map(async (c) => ({
      commitment: c,
      ownerName: c.owner_profile_id
        ? rosterById.get(c.owner_profile_id) ?? null
        : null,
      alreadyAdded: addedCommitmentDescriptions.has(c.description),
      similar: await findSimilarOpenItem(companyId, c.description),
    }))
  );

  // Priority + functional area options feed the picker on the
  // extracted-commitments section (only rendered when auto-tracking
  // is off). Fetched here so client component gets them without a
  // second round-trip.
  const openQuarter = await getCurrentQuarter(meeting.company_id);
  const [{ data: priorityRows }, { data: fnRows }] = await Promise.all([
    openQuarter
      ? supabase
          .from("priorities")
          .select("id, title")
          .eq("company_id", meeting.company_id)
          .eq("quarter_id", openQuarter.id)
          .eq("archived", false)
          .order("title")
      : Promise.resolve({ data: [] as Array<Pick<Priority, "id" | "title">> }),
    supabase
      .from("functions")
      .select("id, title")
      .eq("company_id", meeting.company_id)
      .eq("archived", false)
      .order("title"),
  ]);
  const priorityOptions = (priorityRows ?? []) as Array<
    Pick<Priority, "id" | "title">
  >;
  const functionalAreaOptions = (fnRows ?? []) as Array<{
    id: string;
    title: string;
  }>;

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
            This meeting analysis is visible to everyone at this company.
            Facilitation reviews and raw transcripts stay admin-only.
            Commitments extracted from the meeting appear in each owner&rsquo;s
            Commitments list and scorecard — same visibility as any other
            commitment.
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

        {/* Auto-tracking OFF: the extraction pipeline stored the
            commitments in analysis.commitments_json but didn't
            create rows. Render the routing UI so an admin can
            add each with the intended link. */}
        {!autoTrackOn && commitmentExtractionRows.length > 0 ? (
          <ExtractedCommitmentsSection
            meetingId={meeting.id}
            rows={commitmentExtractionRows}
            priorityOptions={priorityOptions}
            functionalAreaOptions={functionalAreaOptions}
            canAdd={isAdmin}
          />
        ) : null}

        {/* Extracted issues — always surfaced regardless of the
            auto-tracking flag; issues are NEVER auto-created. */}
        {issueRows.length > 0 ? (
          <ExtractedIssuesSection
            meetingId={meeting.id}
            rows={issueRows}
            canAdd={isAdmin}
          />
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

        {/* Show the re-run affordance ONLY when the feature is on and
            the facilitation didn't land — either the review is absent
            entirely or it exists with a null overall AND wasn't
            flagged insufficient (a truly-insufficient transcript
            won't score any better on re-run; hiding the button avoids
            futile clicks). Once a real score is present, hide it too. */}
        {facilitationOn &&
        (!facilitationReview ||
          (facilitationReview.overall == null &&
            !facilitationReview.insufficient_transcript)) ? (
          <section
            aria-label="Facilitation review actions"
            style={{ marginTop: "var(--space-6)" }}
          >
            <RerunFacilitationButton meetingId={id} />
          </section>
        ) : null}

        {isAdmin ? (
          <section
            aria-label="Meeting analysis actions"
            style={{
              marginTop: "var(--space-6)",
              paddingTop: "var(--space-4)",
              borderTop: "1px solid var(--border)",
            }}
          >
            <ReanalyzeMeetingButton meetingId={id} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
