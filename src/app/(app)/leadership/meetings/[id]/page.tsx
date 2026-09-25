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
import { ReanalyzeMeetingButton } from "./ReanalyzeMeetingButton";
import type { FacilitationReview as FacilitationReviewData } from "@/lib/leadership/facilitation/types";
import { isScoredReview } from "@/lib/leadership/facilitation/scored";
import { splitCoreValues } from "@/lib/transcripts/section-order";
import { attendeesFromSummary } from "@/lib/transcripts/attendees";
import { scoreForRow } from "@/lib/leadership/facilitation/score";
import { displayScore, signalTone } from "@/components/leadership/FacilitationReview";
import { dueLabel } from "@/lib/commitments/due-label";
import { isAimsChampion } from "@/lib/guide/champion";
import { AnalysisTabs } from "./AnalysisTabs";
import tabStyles from "./analysis-tabs.module.css";
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
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Full meeting analysis + commitments the meeting spawned. Reached
// from /leadership. Open to every same-company member; RLS on
// meetings + meeting_analyses admits authenticated users whose
// profile.company_id matches. The facilitation review is for the
// company's admins, guides, system admins and the AiMS champion; the
// rerun button is system_admin only. Both gated in the render below.

type PageProps = { params: Promise<{ id: string }> };

export default async function MeetingAnalysisPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
      .select("id, description, owner_id, due_date, due_date_defaulted")
      .eq("source_meeting_id", id),
  ]);

  // Facilitation review only surfaces when the feature is on, the
  // caller is one of the people it is for (below), AND the analysis
  // row actually carries a review (older rows, or rows analyzed while
  // the flag was off, stay null and render nothing). Other members
  // do not see it: it grades the meeting leader.
  const facilitationFeatureOn = await companyHasFeature(
    meeting.company_id,
    "meeting_facilitation_review"
  );
  // Who sees the full Coaching notes tab, scores included: the
  // company's admins, its guides and system admins (all of whom
  // isAdminForCompany admits), and the AiMS champion, who is often a
  // team_member and is the person the notes are for. Jason,
  // 2026-09-25. Everyone else at the company sees Core Values.
  const isChampion = isAdmin
    ? false
    : await isAimsChampion(session.profile.id, meeting.company_id);
  const facilitationOn = facilitationFeatureOn && (isAdmin || isChampion);
  // isScoredReview, not just "a row is present". A review that
  // scored nothing renders as a card full of dashes while the
  // meetings list shows an empty Facilitation cell for the same
  // meeting, and the two disagree about whether a review exists.
  // The analyzer no longer stores these; this handles the ones
  // already stored, without needing them re-analysed.
  const storedReview = (analysis?.facilitation_review_json ??
    null) as FacilitationReviewData | null;
  const facilitationReview =
    facilitationOn && storedReview && isScoredReview(storedReview)
      ? storedReview
      : null;

  const commitmentRows = (commitments ?? []) as Array<{
    id: string;
    description: string;
    owner_id: string | null;
    due_date: string;
    due_date_defaulted: boolean | null;
  }>;
  // Reanalyze (and first-run) leave meeting.status in "pending" or
  // "analyzing" until the LLM call returns. The summary body renders
  // empty during that window — surface a processing banner so the
  // reader doesn't read the empty state as "extraction returned
  // nothing".
  const isProcessing =
    meeting.status === "pending" || meeting.status === "analyzing";

  // Split once: the values card and the analysis card both read it.
  const analysisParts = splitCoreValues(analysis?.analysis_markdown ?? "");
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

  // Names only, from the summary's own attendee list: the same list
  // the owner check reads (attendees.ts), hedged lines left out.
  // Names only: "Casey Benson (CEO)" is Casey Benson on the strip.
  const attendees = attendeesFromSummary(analysis?.analysis_markdown ?? "")
    .map((a) => a.replace(/\s*\([^)]*\)/g, "").split(",")[0].trim())
    .filter((a) => a.length > 0);
  const score = facilitationReview
    ? scoreForRow(analysis, facilitationReview)
    : null;

  // ---- Tab 1: Coaching notes ----------------------------------
  const coachingNotes = (
    <>
      {/* Core Values first on the tab, in its own card. Absent is
          ordinary: the prompt omits the section rather than
          manufacture one, and then no card renders. */}
      {analysisParts.values ? (
        <section className={styles.card} aria-labelledby="core-values">
          <h2 id="core-values" className={styles.h2}>
            Core Values in Action
          </h2>
          <div className="aims-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {analysisParts.values}
            </ReactMarkdown>
          </div>
        </section>
      ) : null}
      {facilitationReview ? (
        <FacilitationReview review={facilitationReview} score={score} />
      ) : null}
      {!analysisParts.values && !facilitationReview ? (
        <p className={styles.emptyLine}>No coaching notes for this meeting.</p>
      ) : null}
    </>
  );

  // ---- Tab 2: Issues and commitments --------------------------
  const hasTab2 =
    (autoTrackOn && commitmentRows.length > 0) ||
    (!autoTrackOn && commitmentExtractionRows.length > 0) ||
    issueRows.length > 0;
  const issuesAndCommitments = (
    <>
      {/* AUTO-TRACKING ON ONLY. These rows exist whenever the
          pipeline created them, or whenever an admin added one from
          Commitments identified, which is how a company with
          tracking OFF ends up with both. Only one is ever the right
          answer, and with tracking off it is the other one. */}
      {autoTrackOn && commitmentRows.length > 0 ? (
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
                    : "Unassigned"}
                  {" · "}
                  {c.due_date_defaulted ? dueLabel(c) : `Due ${dueLabel(c)}`}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Auto-tracking OFF: extracted but not created. The routing
          UI lets an admin add each with the intended link. */}
      {!autoTrackOn && commitmentExtractionRows.length > 0 ? (
        <ExtractedCommitmentsSection
          meetingId={meeting.id}
          rows={commitmentExtractionRows}
          priorityOptions={priorityOptions}
          functionalAreaOptions={functionalAreaOptions}
          canAdd={isAdmin}
        />
      ) : null}

      {/* Issues are NEVER auto-created, whatever the flag. */}
      {issueRows.length > 0 ? (
        <ExtractedIssuesSection
          meetingId={meeting.id}
          rows={issueRows}
          canAdd={isAdmin}
        />
      ) : null}

      {!hasTab2 ? (
        <p className={styles.emptyLine}>
          No commitments or issues came out of this meeting.
        </p>
      ) : null}
    </>
  );

  // ---- Tab 3: Meeting Analysis --------------------------------
  const fullRecord = (
    <section className={styles.card} aria-labelledby="analysis">
      <h2 id="analysis" className={styles.h2}>
        Meeting Analysis
      </h2>
      {analysis?.analysis_markdown ? (
        <>
          {/* SAY SO WHEN IT IS CUT OFF, from the recorded flag
              (0233), never guessed from the punctuation. */}
          {analysis.truncated ? (
            <p className={styles.emptyLine} role="status">
              This summary was cut short before it finished. The
              commitments and the meeting review are complete, because
              they come from separate passes. Reanalyze the meeting to
              generate the full summary.
            </p>
          ) : null}
          <div className="aims-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {/* Core Values lives on the Coaching notes tab. See
                  section-order.ts. */}
              {analysisParts.rest}
            </ReactMarkdown>
          </div>
        </>
      ) : (
        <p className={styles.emptyLine}>Analysis not available.</p>
      )}
    </section>
  );

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
          {/* The date is on the strip below; saying it here too was the
              same fact twice. With tracking off, "0 commitments created"
              is true and misleading, so it is left out. */}
          {autoTrackOn ? (
            <p className={styles.subtitle}>
              {commitmentRows.length} commitment
              {commitmentRows.length === 1 ? "" : "s"} created
            </p>
          ) : null}
        </div>
      </section>

      <div className={styles.content}>
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

        {/* THE STRIP. Above the tabs, so it stays on every tab: when,
            who, and (for the people who can see the review) the score,
            rounded. The exact figure is in the review's "How this is
            scored". */}
        <div className={tabStyles.strip} aria-label="Meeting at a glance">
          <div className={tabStyles.stripItem}>
            <span className={tabStyles.stripLabel}>Date</span>
            <span className={tabStyles.stripDate}>
              <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
                <rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {new Date(meeting.created_at).toLocaleDateString(undefined, {
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          <div className={tabStyles.stripItem}>
            {attendees.length > 0 ? (
              <>
                <span className={tabStyles.stripLabel}>Attendees</span>
                <ul className={tabStyles.people}>
                  {attendees.map((name) => (
                    <li key={name} className={tabStyles.person}>
                      <span className={tabStyles.initials} aria-hidden="true">
                        {name
                          .split(/\s+/)
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </span>
                      {name}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          {facilitationReview && score ? (
            <div
              className={tabStyles.signal}
              data-tone={signalTone(displayScore(score))}
            >
              <span className={tabStyles.signalLabel}>Facilitation signal</span>
              <span className={tabStyles.signalNumber}>{displayScore(score)}</span>
              <span className={tabStyles.signalDenom}>/10</span>
            </div>
          ) : null}
        </div>

        <AnalysisTabs
          tabs={[
            {
              hash: "coaching-notes",
              label: "Coaching notes",
              content: coachingNotes,
            },
            {
              hash: "issues-and-commitments",
              label: "Issues and commitments",
              count:
                (autoTrackOn ? commitmentRows.length : commitmentExtractionRows.length) +
                issueRows.length,
              content: issuesAndCommitments,
            },
            {
              hash: "meeting-analysis",
              label: "Meeting Analysis",
              content: fullRecord,
            },
          ]}
        />

        {/* System admins only, and only for a meeting with no
            commitments or issues created from it: Reanalyze replaces
            the analysis, and on a meeting with live work that used to
            mean deleting it. The action refuses the same cases. */}
        {session.profile.role === "system_admin" &&
        !isProcessing &&
        commitmentRows.length === 0 &&
        addedIssueRows.length === 0 ? (
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
