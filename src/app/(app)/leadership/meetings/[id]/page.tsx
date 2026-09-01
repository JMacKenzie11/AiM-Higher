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
import {
  findSimilarOpenItem,
  type SimilarMatch,
} from "@/lib/transcripts/similarity";
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
import processingStyles from "./extracted.module.css";

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
  // Reanalyze (and first-run) leave meeting.status in "pending" or
  // "analyzing" until the LLM call returns. The summary body renders
  // empty during that window — surface a processing banner so the
  // reader doesn't read the empty state as "extraction returned
  // nothing".
  const isProcessing =
    meeting.status === "pending" || meeting.status === "analyzing";
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
  // paint (no client fetch, no flicker). Also grab the ids of the
  // rows that already came from this meeting — the similarity
  // check would otherwise flag each just-added commitment/issue as
  // "possibly already captured" (self-match).
  const [alreadyAddedIssues, alreadyAddedCommitments] = await Promise.all([
    supabase
      .from("issues")
      .select("id, title, status")
      .eq("source_meeting_id", meeting.id),
    supabase
      .from("commitments")
      .select("id, description, priority_id, functional_area_id")
      .eq("source_meeting_id", meeting.id)
      .is("deleted_at", null),
  ]);
  const addedIssueRows = (alreadyAddedIssues.data ?? []) as Array<{
    id: string;
    title: string;
    status: "open" | "resolved";
  }>;
  const addedCommitmentRows = (alreadyAddedCommitments.data ?? []) as Array<{
    id: string;
    description: string;
    priority_id: string | null;
    functional_area_id: string | null;
  }>;
  const addedIssueTitles = new Set(addedIssueRows.map((r) => r.title));
  // Title → status map so the extracted-issue row can remember
  // whether it was added-as-open or resolved-in-meeting across a
  // page refresh (drives the chip label).
  const addedIssueStatusByTitle = new Map(
    addedIssueRows.map((r) => [r.title, r.status])
  );
  const addedCommitmentDescriptions = new Set(
    addedCommitmentRows.map((r) => r.description)
  );
  const addedIssueIds = new Set(addedIssueRows.map((r) => r.id));
  const addedCommitmentIds = new Set(addedCommitmentRows.map((r) => r.id));

  // Fetch the priority + functional-area titles for every already-
  // added commitment in one round-trip each. Feeds the richer
  // done-state label ("Added to [Priority name]" / "Added to
  // [Function name]") so the reader can see WHERE the commitment
  // landed without navigating away.
  const priorityIdsForLink = Array.from(
    new Set(
      addedCommitmentRows
        .map((c) => c.priority_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const functionalAreaIdsForLink = Array.from(
    new Set(
      addedCommitmentRows
        .map((c) => c.functional_area_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const [priorityTitleRes, functionTitleRes] = await Promise.all([
    priorityIdsForLink.length > 0
      ? supabase
          .from("priorities")
          .select("id, title")
          .in("id", priorityIdsForLink)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string }> }),
    functionalAreaIdsForLink.length > 0
      ? supabase
          .from("functions")
          .select("id, title")
          .in("id", functionalAreaIdsForLink)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string }> }),
  ]);
  const priorityTitleById = new Map(
    ((priorityTitleRes.data ?? []) as Array<{ id: string; title: string }>).map(
      (r) => [r.id, r.title]
    )
  );
  const functionTitleById = new Map(
    ((functionTitleRes.data ?? []) as Array<{ id: string; title: string }>).map(
      (r) => [r.id, r.title]
    )
  );

  // Description → link details lookup for the done-state label.
  // Idempotency in the routing action matches by exact description,
  // so we key here by exact description too.
  type CommitmentLinkInfo =
    | { kind: "priority"; title: string }
    | { kind: "functional_area"; title: string }
    | { kind: "none" };
  const commitmentLinkByDescription = new Map<string, CommitmentLinkInfo>();
  for (const c of addedCommitmentRows) {
    let info: CommitmentLinkInfo;
    if (c.priority_id) {
      info = {
        kind: "priority",
        title: priorityTitleById.get(c.priority_id) ?? "priority",
      };
    } else if (c.functional_area_id) {
      info = {
        kind: "functional_area",
        title: functionTitleById.get(c.functional_area_id) ?? "functional area",
      };
    } else {
      info = { kind: "none" };
    }
    commitmentLinkByDescription.set(c.description, info);
  }

  // Drop a similarity hit when it points at something this meeting
  // itself produced — that's a definite duplicate, not a "possibly
  // already captured" hint. The done-state pill covers that case.
  function stripSelfMatch(match: SimilarMatch | null): SimilarMatch | null {
    if (!match) return null;
    if (match.kind === "commitment" && addedCommitmentIds.has(match.id)) {
      return null;
    }
    if (match.kind === "issue" && addedIssueIds.has(match.id)) {
      return null;
    }
    return match;
  }

  // Fire the similarity loops (duplicate awareness for each
  // extracted item, 14-day window) alongside the picker-option
  // fetches. The two are independent: similarity feeds the badge
  // on each extraction row, options feed the Link-to-priority /
  // Link-to-functional-area selects. Before this the picker
  // fetches waited on the similarity loop's Promise.all to
  // resolve — 1 extra sequential round-trip on page load for a
  // shape they don't share. Priorities still depend on the open
  // quarter, so that chain stays inside its own async block.
  const companyId = meeting.company_id;

  const [
    issueRows,
    commitmentExtractionRows,
    priorityResult,
    functionsResult,
  ] = await Promise.all([
    Promise.all<ExtractedIssueRow>(
      extractedIssues.map(async (issue) => ({
        issue,
        alreadyAdded: addedIssueTitles.has(issue.title),
        alreadyAddedAs: addedIssueStatusByTitle.get(issue.title) ?? null,
        similar: stripSelfMatch(
          await findSimilarOpenItem(companyId, issue.title)
        ),
      }))
    ),
    Promise.all<ExtractedCommitmentRow>(
      extractedCommitments.map(async (c) => {
        // Priority order: a commitment lookup wins, THEN an issue
        // lookup — the same extraction can't have both, but the
        // idempotency contract keys on description, so a rare
        // collision resolves in favor of the commitment shape.
        const link = commitmentLinkByDescription.get(c.description);
        const addedAs: ExtractedCommitmentRow["addedAs"] = link
          ? { kind: "commitment", link }
          : addedIssueTitles.has(c.description)
            ? { kind: "issue" }
            : null;
        return {
          commitment: c,
          ownerName: c.owner_profile_id
            ? rosterById.get(c.owner_profile_id) ?? null
            : null,
          addedAs,
          similar: stripSelfMatch(
            await findSimilarOpenItem(companyId, c.description)
          ),
        };
      })
    ),
    // Priorities gate on the open quarter, so keep the chain
    // inside its own async — but the whole chain still runs
    // concurrently with the similarity loops above.
    (async () => {
      const openQuarter = await getCurrentQuarter(companyId);
      if (!openQuarter) {
        return { data: [] as Array<Pick<Priority, "id" | "title">> };
      }
      return supabase
        .from("priorities")
        .select("id, title")
        .eq("company_id", companyId)
        .eq("quarter_id", openQuarter.id)
        .eq("archived", false)
        .order("title");
    })(),
    supabase
      .from("functions")
      .select("id, title")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("title"),
  ]);
  const { data: priorityRows } = priorityResult;
  const { data: fnRows } = functionsResult;
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

        {isProcessing ? (
          <div
            className={processingStyles.processingBanner}
            role="status"
            aria-live="polite"
          >
            <span
              className={processingStyles.processingDot}
              aria-hidden="true"
            />
            <span>
              Analyzing this meeting.{" "}
              <span className={processingStyles.processingHint}>
                Refresh in 30-90 seconds to see the summary, commitments, and
                issues.
              </span>
            </span>
          </div>
        ) : null}

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

        {isAdmin && !isProcessing ? (
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
