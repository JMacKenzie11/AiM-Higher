import {
  selectForContext,
  formatMemoryBlock,
  CONTEXT_MEMORY_LIMIT,
  type StoredMemory,
} from "./memory-shape";
import { reportError } from "@/lib/observability/report";
import { compareToOwnBaseline, themesFrom } from "./history-shape";
import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { todayInTimezone } from "@/lib/dates";
import { computeFollowThroughRate } from "@/lib/utils";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { SUB_STRENGTH_LABELS } from "@/lib/strengths/types";
import type { ResultsProfile } from "@/lib/strengths/types";
import { buildPartnerContext } from "@/lib/practices/partner-context";
import { findPractice } from "@/lib/practices/registry";
import type {
  AnnualGoal,
  Commitment,
  CompanyFoundation,
  FoundationItem,
  Priority,
  Profile,
  Quarter,
  UserStrength,
} from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Assembles the fresh <company_context>, <person_context>, and
// <coaching_context> blocks that ride alongside every message send.
// The static leadership-coach.md prompt stays cacheable; this dynamic
// context is appended fresh each turn so numbers and reasons reflect
// the live database.
//
// Design intent (from the coaching feature spec):
//   - company_context: name, purpose, core values, differentiators
//   - person_context: role/position, keep rate this + two prior
//                     quarters, kept/missed counts this quarter, every
//                     missed commitment this quarter with description
//                     + verbatim reason, open commitments with due
//                     dates, titles/statuses of the priorities and
//                     goals they own.
//   - coaching_context: who's being coached about + today's date.
//
// Note re "commitments carried more than once": migration 0011 removed
// the carried status. The signal is intentionally dropped here — the
// current model treats a late-close as Missed and the reason field
// carries the improvement hook.

export type CoachContextInput = {
  companyId: string;
  // Null = general ("Ask Aimee") — no subject on file. Person context
  // and strengths context are skipped, and no subject-scoped queries
  // are issued.
  subjectProfileId: string | null;
  currentAdminName: string;
  currentAdminProfileId: string;
  contextKind?: "execution" | "strengths";
  // Practices layer. When practiceId is set, this is a guided
  // practice session: the user's own person_context is loaded (even
  // though mode is 'general'), and if partnerProfileId is set a
  // strict-allow-list partner_context block is added. See
  // lib/practices/partner-context.ts for the allow-list rules.
  practiceId?: string | null;
  partnerProfileId?: string | null;
};

export type CoachContextBlocks = {
  companyContext: string;
  // What the coach remembers about the PARTICIPANT from their previous
  // conversations, in either mode. Null only when there is nothing to
  // recall. It is always the participant's own memory: a leader's
  // memory is recalled to the leader, never to or about the subject.
  // Recency-weighted and capped; older memories fall out of this
  // block and stay reachable through memory_lookup.
  memoryContext: string | null;
  // Null in general mode (except for practices, which load the
  // participant's own person_context so the coach can ground its
  // guidance in the participant's actual role and history).
  personContext: string | null;
  // Partner context for practice sessions where the participant
  // named who the conversation is about. Strict allow-list — no
  // strengths, no missed reasons, no coaching data.
  partnerContext: string | null;
  // Null when the subject has no strengths or the mode is general.
  strengthsContext: string | null;
  coachingContext: string;
  mode: "about" | "general";
};

export async function buildCoachContext(
  input: CoachContextInput
): Promise<CoachContextBlocks> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  // Determine whose person_context to load:
  //   about   → the named subject
  //   practice→ the participant (they are their own subject)
  //   general → nobody
  const practice = findPractice(input.practiceId ?? null);
  const isPractice = practice !== null;
  const subjectForBundle: string | null =
    input.subjectProfileId ??
    (isPractice ? input.currentAdminProfileId : null);

  const [
    { data: company },
    { data: foundation },
    { data: foundationItems },
    subjectBundle,
    partnerContext,
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, timezone")
      .eq("id", input.companyId)
      .maybeSingle<{ id: string; name: string; timezone: string }>(),
    supabase
      .from("company_foundation")
      .select("*")
      .eq("company_id", input.companyId)
      .maybeSingle<CompanyFoundation>(),
    supabase
      .from("foundation_items")
      .select("*")
      .eq("company_id", input.companyId)
      .in("kind", ["core_value", "differentiator"]),
    subjectForBundle
      ? loadSubjectBundle(supabase, input.companyId, subjectForBundle)
      : Promise.resolve(null),
    isPractice && input.partnerProfileId
      ? buildPartnerContext({
          callerProfileId: input.currentAdminProfileId,
          companyId: input.companyId,
          partnerProfileId: input.partnerProfileId,
        })
      : Promise.resolve(null),
  ]);

  const tz = company?.timezone ?? "America/Anchorage";
  const { iso: todayIso } = todayInTimezone(tz);

  const items = (foundationItems ?? []) as FoundationItem[];
  const coreValues = items.filter((i) => i.kind === "core_value");
  const differentiators = items.filter((i) => i.kind === "differentiator");

  const companyContext = formatCompanyContext({
    companyName: company?.name ?? "(unknown company)",
    foundation,
    coreValues,
    differentiators,
  });

  const mode: "about" | "general" = input.subjectProfileId ? "about" : "general";

  // Read-before, in BOTH modes as of 2026-09-14, and about the
  // participant, never the subject: memory is written for whoever is
  // talking, so that is the only person it can honestly be recalled
  // to. currentAdminProfileId is that person in either mode.
  //
  // This used to be general-only, on the reasoning that recalling a
  // leader's own memory into a conversation about somebody else was
  // "material from a different relationship". That held while memory
  // came only from general-mode conversations. Now that an about-mode
  // conversation is itself summarized, in the participant frame, the
  // leader's memory is exactly the thread to pick up: what they said
  // last time they sat down to think about this person, and whether
  // they did it. Withholding it would make the write half useless.
  const memoryContext = await loadMemoryContext(
    supabase,
    input.currentAdminProfileId,
    todayIso,
    input.subjectProfileId ?? null
  );

  if (!subjectBundle) {
    // Vanilla general mode — Ask Aimee. No subject; no person,
    // keep-rate, or strengths context. The coach relies on what the
    // user shares in-thread, plus the company context above.
    const coachingContext = [
      "<coaching_context>",
      "Mode: general",
      `Coaching participant: ${input.currentAdminName}`,
      "There is no subject on file. The participant brings the situation in-thread — they may be talking about themselves, another person, a decision, or a conversation they're preparing for. Follow their lead.",
      "You know nothing about any person the participant names — no commitments, no history, no profile. If asked what you know about someone, say so plainly. Never invent details about a person.",
      `Today: ${todayIso}`,
      "</coaching_context>",
    ].join("\n");
    return {
      companyContext,
      memoryContext,
      personContext: null,
      partnerContext: null,
      strengthsContext: null,
      coachingContext,
      mode,
    };
  }

  const {
    subject,
    openQuarter,
    keepRatesByQuarter,
    commitmentStats,
    baseline,
    openIssues,
    plan,
    strengthsContext,
  } = subjectBundle;
  const {
    keptOnTimeCount,
    keptLateCount,
    missedCount,
    parkedCount,
    adminResolvedWithoutReasonCount,
    missed,
    keptLate,
    openCommitments,
  } = commitmentStats;

  const personContext = formatPersonContext({
    subject,
    todayIso,
    keepRatesByQuarter,
    openQuarter,
    keptOnTimeCount,
    keptLateCount,
    missedCount,
    parkedCount,
    adminResolvedWithoutReasonCount,
    missed,
    keptLate,
    openCommitments,
    baseline,
    openIssues,
    priorities: plan.priorities,
    goals: plan.goals,
  });

  const coachingContext = isPractice
    ? [
        "<coaching_context>",
        "Mode: practice",
        `Coaching participant: ${input.currentAdminName}`,
        `This is a guided practice session: ${practice.title}.`,
        partnerContext
          ? "The participant has named who the conversation is about. Their partner's platform data is provided in <partner_context> for grounding — use it to keep observations specific, not to escalate."
          : "The participant has not named a partner. Draw only on what they share in-thread; do not invent names or details.",
        `Today: ${todayIso}`,
        "</coaching_context>",
      ].join("\n")
    : [
        "<coaching_context>",
        "Mode: about",
        `Being coached about: ${subject?.full_name ?? "(unknown subject)"}`,
        `Coaching participant: ${input.currentAdminName}`,
        "This is a leadership coaching session about another person. Refer to the subject by their name.",
        "Pronouns for the subject are unknown. Use they/them by default; never infer gender from names. If you use a name repeatedly, that's fine — just do not guess pronouns.",
        "If strengths data is marked incomplete or unavailable, say so if asked and never invent or guess strengths.",
        `Today: ${todayIso}`,
        "</coaching_context>",
      ].join("\n");

  return {
    companyContext,
    memoryContext,
    personContext,
    partnerContext,
    // Strengths for a practice session would leak the participant's
    // own strengths into a prompt that doesn't reference them —
    // harmless privacy-wise (they own their strengths) but noise.
    // Keep strengths context out of practices.
    strengthsContext: isPractice ? null : strengthsContext,
    coachingContext,
    mode,
  };
}

// ---- Subject bundle -------------------------------------------
// Wraps every subject-scoped query into one call so the top-level
// buildCoachContext can skip all of it cleanly when the mode is
// general. Runs the intra-bundle queries in parallel + the wave-2
// dependent queries (quarter-scoped rates) after.
// LONGITUDINAL DEPTH, capped. Six quarters is eighteen months, which
// is long enough for "third quarter running" to be a claim the data
// can actually support and short enough that the block stays a
// handful of lines. It was two, which could show a change but never a
// pattern.
//
// Bounded by the person's TENURE where hire_date is known: a quarter
// that closed before somebody joined is not a quarter they had, and
// listing it with a blank rate invites reading an absence as a lapse.
const PERSON_BLOCK_QUARTERS = 6;

// Aggregates only in the default block. The tools exist for
// drill-down, and paying for verbatim history in every turn of every
// conversation buys depth the conversation has not asked for yet.
const MAX_OPEN_ISSUES_LISTED = 5;

async function loadSubjectBundle(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  subjectProfileId: string
) {
  const [
    { data: subject },
    openQuarter,
    priorQuarters,
    plan,
    strengthsContext,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, position, role, company_id, hire_date")
      .eq("id", subjectProfileId)
      .maybeSingle<
        Pick<
          Profile,
          "id" | "full_name" | "position" | "role" | "company_id" | "hire_date"
        >
      >(),
    getCurrentQuarter(companyId),
    loadPriorQuarters(supabase, companyId, PERSON_BLOCK_QUARTERS),
    loadOwnedPlanItems(supabase, subjectProfileId),
    buildStrengthsContext({ supabase, subjectProfileId, companyId }),
  ]);

  const hired = subject?.hire_date ?? null;
  const quartersForRate = [openQuarter, ...priorQuarters]
    .filter((q): q is Quarter => Boolean(q))
    // A quarter that closed before they arrived is not theirs.
    .filter((q) => !hired || q.end_date >= hired);

  const [keepRatesByQuarter, commitmentStats] = await Promise.all([
    Promise.all(
      quartersForRate.map(async (q) => ({
        quarter: q,
        keepRate: await computeQuarterKeepRateForSubject(
          supabase,
          companyId,
          subjectProfileId,
          q
        ),
      }))
    ),
    loadSubjectCommitments(supabase, subjectProfileId, openQuarter),
  ]);

  // Their own baseline, not the company's and not a fixed bar. Null
  // when there is too little to compare, which is the case the
  // provenance guidance turns on — see prompts/leadership-coach.md.
  const rated = keepRatesByQuarter.map((r) => ({
    follow_through_pct: r.keepRate,
  }));
  const baseline =
    rated.length > 0 ? compareToOwnBaseline(rated[0]!, rated.slice(1)) : null;

  const openIssues = await loadSubjectOpenIssues(supabase, subjectProfileId);

  return {
    subject,
    openQuarter,
    keepRatesByQuarter,
    commitmentStats,
    baseline,
    openIssues,
    plan,
    strengthsContext,
  };
}

// Open issues the subject is carrying: ones where they own a
// commitment that is still open. Deliberately NOT "issues they
// raised" — an issue someone raised and handed on is not work they
// are carrying, and the coaching question is what is on them now.
async function loadSubjectOpenIssues(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  subjectProfileId: string
): Promise<Array<{ title: string; attempts: number }>> {
  const { data: mine } = await supabase
    .from("commitments")
    .select("issue_id")
    .eq("owner_id", subjectProfileId)
    .eq("status", "open")
    .not("issue_id", "is", null)
    .is("deleted_at", null)
    .is("parked_at", null);
  const ids = [
    ...new Set(
      ((mine ?? []) as Array<{ issue_id: string | null }>)
        .map((r) => r.issue_id)
        .filter((id): id is string => Boolean(id))
    ),
  ].slice(0, MAX_OPEN_ISSUES_LISTED);
  if (ids.length === 0) return [];

  const [{ data: issueRows }, { data: allCommitments }] = await Promise.all([
    supabase
      .from("issues")
      .select("id, title")
      .in("id", ids)
      .eq("status", "open"),
    supabase
      .from("commitments")
      .select("issue_id")
      .in("issue_id", ids)
      .is("deleted_at", null),
  ]);
  const counts = new Map<string, number>();
  for (const row of (allCommitments ?? []) as Array<{ issue_id: string | null }>) {
    if (row.issue_id) counts.set(row.issue_id, (counts.get(row.issue_id) ?? 0) + 1);
  }
  return ((issueRows ?? []) as Array<{ id: string; title: string }>).map((i) => ({
    title: i.title,
    // How many goes it has taken so far. A count, not the thread —
    // issue_casefiles returns the thread when the conversation wants it.
    attempts: counts.get(i.id) ?? 0,
  }));
}

// Read-before: the participant's own recent memory.
//
// RLS does the work — coach_memories admits `profile_id = auth.uid()`
// and nothing else, so this query CANNOT return another person's rows
// however it is called. The explicit eq() is belt-and-braces and a
// statement of intent, not the boundary.
async function loadMemoryContext(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  participantProfileId: string,
  todayIso: string,
  // In about mode, the person this conversation is about. Their
  // memories are fetched separately and placed first.
  subjectProfileId: string | null = null
): Promise<string | null> {
  const { data } = await supabase
    .from("coach_memories")
    .select("id, kind, content, created_at")
    .eq("profile_id", participantProfileId)
    .order("created_at", { ascending: false })
    // A generous read, narrowed in memory by selectForContext. The
    // window and the cap are a context budget, not a privacy control;
    // the privacy control is the policy.
    .limit(60);
  const rows = (data ?? []) as StoredMemory[];

  // SUBJECT-SCOPED RECALL.
  //
  // A SECOND read rather than a filter over the first, and the
  // difference matters. The pool above is the 60 most recent, so a
  // leader who coaches about several people can have this person's
  // thread fall out of it entirely on recency, which is exactly the
  // case the feature is for: picking a months-old thread about one
  // person back up. Asking for them by name guarantees they are in
  // the pool at all; selectForContext then decides what fits.
  //
  // The join is coach_memories.conversation_ref ->
  // coaching_conversations.subject_profile_id, over the FK declared
  // in 0194. `!inner` makes the embedded filter a join condition
  // rather than a nullable side-load. Both reads run as the caller,
  // so RLS bounds this to the leader's own memory and their own
  // conversations; it can only ever narrow, never widen.
  const priorityIds = new Set<string>();
  if (subjectProfileId) {
    const { data: scoped, error } = await supabase
      .from("coach_memories")
      .select(
        "id, kind, content, created_at, coaching_conversations!inner(subject_profile_id)"
      )
      .eq("profile_id", participantProfileId)
      .eq("coaching_conversations.subject_profile_id", subjectProfileId)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) {
      // Not fatal: the general block below is still correct, just not
      // prioritised. Silence here would make a broken join look like
      // a leader who has never discussed this person.
      reportError("coach.memory.subject_scoped", error, {
        participantProfileId,
        subjectProfileId,
      });
    }
    for (const row of (scoped ?? []) as StoredMemory[]) {
      priorityIds.add(row.id);
      if (!rows.some((r) => r.id === row.id)) rows.push(row);
    }
  }

  const picked = selectForContext(
    rows,
    `${todayIso}T12:00:00Z`,
    CONTEXT_MEMORY_LIMIT,
    priorityIds
  );
  const block = formatMemoryBlock(picked, `${todayIso}T12:00:00Z`);
  return block === "" ? null : block;
}

// Emit the subject's strengths context — combines two sources:
//   1. Admin/self-entered strengths + superpowers (always, no flag)
//   2. Completed AiMS Strengths Assessment summary (only when the
//      company has the strengths feature). The compact summary +
//      top strengths ride in every turn; the coach can still call
//      the get_strengths_profile tool for the full dimensional read.
// Returns null when neither source has anything to report so the
// block is omitted entirely.
async function buildStrengthsContext(args: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  subjectProfileId: string;
  companyId: string;
}): Promise<string | null> {
  const [{ data: manualRows }, assessmentSummary] = await Promise.all([
    args.supabase
      .from("user_strengths")
      .select("kind, label, sort_order")
      .eq("user_id", args.subjectProfileId)
      .order("sort_order", { ascending: true }),
    loadAssessmentSummaryIfAvailable(args),
  ]);

  const rows = (manualRows ?? []) as Array<
    Pick<UserStrength, "kind" | "label" | "sort_order">
  >;
  const strengths = rows.filter((r) => r.kind === "strength").map((r) => r.label);
  const superpowers = rows
    .filter((r) => r.kind === "superpower")
    .map((r) => r.label);

  const hasManual = strengths.length > 0 || superpowers.length > 0;
  if (!hasManual && !assessmentSummary) return null;

  const lines: string[] = ["<strengths_context>"];
  if (hasManual) {
    lines.push("Manually recorded (admin/self-entered):");
    if (strengths.length > 0) {
      lines.push(`- Strengths: ${strengths.join(", ")}`);
    }
    if (superpowers.length > 0) {
      lines.push(`- Superpowers: ${superpowers.join(", ")}`);
    }
  }
  if (assessmentSummary) {
    if (hasManual) lines.push("");
    lines.push("AiMS Strengths Assessment (completed):");
    if (assessmentSummary.topStrengths.length > 0) {
      lines.push(`- Top strengths: ${assessmentSummary.topStrengths.join(", ")}`);
    }
    if (assessmentSummary.orientation) {
      lines.push(`- Orientation lean: ${assessmentSummary.orientation}`);
    }
    lines.push("- Narrative summary:");
    lines.push(assessmentSummary.summary.trim());
    lines.push(
      "(Call get_strengths_profile for the full dimensional read if you need it.)"
    );
  }
  lines.push("</strengths_context>");
  return lines.join("\n");
}

// Returns null when the feature is off for the company or the
// subject hasn't completed an assessment. Small helper so the outer
// function stays flat.
async function loadAssessmentSummaryIfAvailable(args: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  subjectProfileId: string;
  companyId: string;
}): Promise<{
  topStrengths: string[];
  orientation: string | null;
  summary: string;
} | null> {
  const enabled = await companyHasFeature(args.companyId, "strengths");
  if (!enabled) return null;

  const { data: assessment } = await args.supabase
    .from("strengths_assessments")
    .select("id")
    .eq("user_id", args.subjectProfileId)
    .eq("status", "completed")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!assessment) return null;

  const { data: results } = await args.supabase
    .from("strengths_results")
    .select("profile, summary")
    .eq("assessment_id", assessment.id)
    .maybeSingle<{ profile: ResultsProfile; summary: string }>();
  if (!results) return null;

  const topStrengths = (results.profile.top_strengths ?? []).map(
    (key) => SUB_STRENGTH_LABELS[key] ?? key
  );
  return {
    topStrengths,
    orientation: results.profile.orientation?.lean ?? null,
    summary: results.summary,
  };
}

// ---- Helpers ---------------------------------------------------

async function loadPriorQuarters(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  count: number
): Promise<Quarter[]> {
  const { data } = await supabase
    .from("quarters")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "closed")
    .order("end_date", { ascending: false })
    .limit(count);
  return (data ?? []) as Quarter[];
}

async function computeQuarterKeepRateForSubject(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  subjectId: string,
  quarter: Pick<Quarter, "start_date" | "end_date">
): Promise<number | null> {
  const { data } = await supabase
    .from("commitments")
    .select("status")
    .eq("company_id", companyId)
    .eq("owner_id", subjectId)
    .gte("week_ending", quarter.start_date)
    .lte("week_ending", quarter.end_date);
  const rows = (data ?? []) as Array<{ status: string }>;
  return computeFollowThroughRate(rows.map((r) => r.status));
}

async function loadSubjectCommitments(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  subjectId: string,
  openQuarter: Quarter | null
): Promise<{
  keptOnTimeCount: number;
  keptLateCount: number;
  missedCount: number;
  parkedCount: number;
  adminResolvedWithoutReasonCount: number;
  missed: Array<
    Pick<Commitment, "description" | "missed_reason" | "week_ending" | "due_date"> & {
      resolved_by_role: string | null;
    }
  >;
  keptLate: Array<
    Pick<Commitment, "description" | "week_ending" | "due_date">
  >;
  openCommitments: Array<
    Pick<Commitment, "description" | "due_date" | "week_ending">
  >;
}> {
  const missed: Array<
    Pick<Commitment, "description" | "missed_reason" | "week_ending" | "due_date"> & {
      resolved_by_role: string | null;
    }
  > = [];
  const keptLate: Array<
    Pick<Commitment, "description" | "week_ending" | "due_date">
  > = [];
  let keptOnTimeCount = 0;
  let keptLateCount = 0;
  let missedCount = 0;
  let adminResolvedWithoutReasonCount = 0;

  if (openQuarter) {
    // Filter out soft-deleted + parked rows — those don't belong in
    // the coaching signal for this quarter (parked appears as its
    // own count below).
    const { data } = await supabase
      .from("commitments")
      .select(
        "description, status, missed_reason, week_ending, due_date, resolved_by_role"
      )
      .eq("owner_id", subjectId)
      .is("deleted_at", null)
      .is("parked_at", null)
      .gte("week_ending", openQuarter.start_date)
      .lte("week_ending", openQuarter.end_date);
    const rows = (data ?? []) as Array<
      Pick<
        Commitment,
        "description" | "status" | "missed_reason" | "week_ending" | "due_date"
      > & { resolved_by_role: string | null }
    >;
    for (const row of rows) {
      if (row.status === "kept_on_time") {
        keptOnTimeCount += 1;
      } else if (row.status === "kept_late") {
        keptLateCount += 1;
        keptLate.push({
          description: row.description,
          week_ending: row.week_ending,
          due_date: row.due_date,
        });
      } else if (row.status === "missed") {
        missedCount += 1;
        missed.push({
          description: row.description,
          missed_reason: row.missed_reason,
          week_ending: row.week_ending,
          due_date: row.due_date,
          resolved_by_role: row.resolved_by_role,
        });
        if (
          (row.resolved_by_role === "admin" ||
            row.resolved_by_role === "guide") &&
          !row.missed_reason?.trim()
        ) {
          adminResolvedWithoutReasonCount += 1;
        }
      }
    }
  }

  const { data: openRows } = await supabase
    .from("commitments")
    .select("description, due_date, week_ending")
    .eq("owner_id", subjectId)
    .eq("status", "open")
    .is("deleted_at", null)
    .is("parked_at", null)
    .order("due_date", { ascending: true });
  const openCommitments = (openRows ?? []) as Array<
    Pick<Commitment, "description" | "due_date" | "week_ending">
  >;

  // Parked count — surfaced in the coaching context when nonzero so
  // a coach can see how much has been set aside.
  const { count: parkedCount } = await supabase
    .from("commitments")
    .select("id", { head: true, count: "exact" })
    .eq("owner_id", subjectId)
    .is("deleted_at", null)
    .not("parked_at", "is", null);

  return {
    keptOnTimeCount,
    keptLateCount,
    missedCount,
    parkedCount: parkedCount ?? 0,
    adminResolvedWithoutReasonCount,
    missed,
    keptLate,
    openCommitments,
  };
}

async function loadOwnedPlanItems(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  subjectId: string
): Promise<{
  priorities: Array<Pick<Priority, "title" | "status">>;
  goals: Array<Pick<AnnualGoal, "title" | "status">>;
}> {
  const [{ data: pRows }, { data: gRows }] = await Promise.all([
    supabase
      .from("priorities")
      .select("title, status, archived")
      .eq("owner_id", subjectId)
      .eq("archived", false),
    supabase
      .from("annual_goals")
      .select("title, status, archived")
      .eq("owner_id", subjectId)
      .eq("archived", false),
  ]);
  return {
    priorities: (pRows ?? []) as Array<Pick<Priority, "title" | "status">>,
    goals: (gRows ?? []) as Array<Pick<AnnualGoal, "title" | "status">>,
  };
}

// ---- Formatters ------------------------------------------------

function formatCompanyContext({
  companyName,
  foundation,
  coreValues,
  differentiators,
}: {
  companyName: string;
  foundation: CompanyFoundation | null;
  coreValues: FoundationItem[];
  differentiators: FoundationItem[];
}): string {
  const lines: string[] = ["<company_context>"];
  lines.push(`Name: ${companyName}`);
  if (foundation?.purpose_statement) {
    lines.push("");
    lines.push("Purpose:");
    lines.push(foundation.purpose_statement.trim());
  }
  if (foundation?.vision) {
    lines.push("");
    lines.push("Vision:");
    lines.push(foundation.vision.trim());
  }
  if (coreValues.length > 0) {
    lines.push("");
    lines.push("Core values:");
    for (const cv of coreValues) {
      const body = cv.body ? ` — ${cv.body.trim()}` : "";
      lines.push(`- ${cv.title.trim()}${body}`);
    }
  }
  if (differentiators.length > 0) {
    lines.push("");
    lines.push("Differentiators:");
    for (const d of differentiators) {
      const body = d.body ? ` — ${d.body.trim()}` : "";
      lines.push(`- ${d.title.trim()}${body}`);
    }
  }
  lines.push("</company_context>");
  return lines.join("\n");
}

// Exported for the context-cost test, which measures the rendered
// artifact rather than a reconstruction of it. A cost budget checked
// against an approximation of the block is a budget on the
// approximation.
export function formatPersonContext({
  subject,
  todayIso,
  keepRatesByQuarter,
  baseline,
  openIssues,
  openQuarter,
  keptOnTimeCount,
  keptLateCount,
  missedCount,
  parkedCount,
  adminResolvedWithoutReasonCount,
  missed,
  keptLate,
  openCommitments,
  priorities,
  goals,
}: {
  subject:
    | Pick<Profile, "id" | "full_name" | "position" | "role" | "company_id">
    | null;
  todayIso: string;
  keepRatesByQuarter: Array<{ quarter: Quarter; keepRate: number | null }>;
  openQuarter: Quarter | null;
  keptOnTimeCount: number;
  keptLateCount: number;
  missedCount: number;
  parkedCount: number;
  adminResolvedWithoutReasonCount: number;
  missed: Array<
    Pick<Commitment, "description" | "missed_reason" | "week_ending" | "due_date"> & {
      resolved_by_role: string | null;
    }
  >;
  keptLate: Array<Pick<Commitment, "description" | "week_ending" | "due_date">>;
  openCommitments: Array<Pick<Commitment, "description" | "due_date" | "week_ending">>;
  baseline: {
    current_pct: number;
    baseline_pct: number;
    baseline_quarters: number;
    delta: number;
  } | null;
  openIssues: Array<{ title: string; attempts: number }>;
  priorities: Array<Pick<Priority, "title" | "status">>;
  goals: Array<Pick<AnnualGoal, "title" | "status">>;
}): string {
  const lines: string[] = ["<person_context>"];
  lines.push(`Name: ${subject?.full_name ?? "(unknown)"}`);
  lines.push(`Position: ${subject?.position ?? "—"}`);
  lines.push(`Role: ${subject?.role ?? "—"}`);
  lines.push(`Today: ${todayIso}`);

  lines.push("");
  lines.push(
    "Follow-through rate by quarter (kept on time ÷ all resolved; most recent first):"
  );
  if (keepRatesByQuarter.length === 0) {
    lines.push("- (no quarters on record)");
  } else {
    for (const row of keepRatesByQuarter) {
      const rate = row.keepRate === null ? "—" : `${row.keepRate}%`;
      lines.push(`- ${row.quarter.label}: ${rate}`);
    }
  }

  // Against their OWN prior quarters. Null when there is too little
  // to compare, and the line then says that rather than going quiet —
  // silence here would read as "nothing notable" when it means
  // "nothing sayable", and those license very different sentences.
  if (baseline) {
    const dir =
      baseline.delta > 0 ? "above" : baseline.delta < 0 ? "below" : "level with";
    lines.push(
      `This quarter vs their own baseline: ${baseline.current_pct}% against ${baseline.baseline_pct}% averaged over their previous ${baseline.baseline_quarters} quarters — ${dir}${baseline.delta === 0 ? "" : ` by ${Math.abs(baseline.delta)} points`}.`
    );
  } else {
    lines.push(
      "This quarter vs their own baseline: not enough history to compare (fewer than two prior quarters with a rate, or nothing resolved yet this quarter). Do not infer a trend from this."
    );
  }

  lines.push("");
  if (openQuarter) {
    lines.push(
      `This quarter (${openQuarter.label}) — kept on time: ${keptOnTimeCount}, kept late: ${keptLateCount}, missed: ${missedCount}.`
    );
    if (parkedCount > 0) {
      lines.push(`Currently parked (set aside): ${parkedCount}.`);
    }
    if (adminResolvedWithoutReasonCount > 0) {
      lines.push(
        `Note: ${adminResolvedWithoutReasonCount} missed commitment${adminResolvedWithoutReasonCount === 1 ? " was" : "s were"} resolved by an admin without a reason. Admin-resolved rows without a reason are typically closed during the weekly meeting on the person's behalf — the absence of a reason is not itself a signal about them.`
      );
    }
  } else {
    lines.push("This quarter: no open quarter.");
  }

  lines.push("");
  lines.push(
    "Kept-late commitments this quarter (did the work, just after the due date):"
  );
  if (keptLate.length === 0) {
    lines.push("- (none)");
  } else {
    for (const k of keptLate) {
      lines.push(`- [${k.due_date}] ${k.description.trim()}`);
    }
  }

  lines.push("");
  lines.push("Every missed commitment this quarter, verbatim reason:");
  if (missed.length === 0) {
    lines.push("- (none)");
  } else {
    for (const m of missed) {
      const reason = m.missed_reason?.trim() || "(no reason recorded)";
      lines.push(`- [${m.due_date}] ${m.description.trim()}`);
      lines.push(`  reason: ${reason}`);
    }
  }

  lines.push("");
  lines.push("Open commitments (due date · description):");
  if (openCommitments.length === 0) {
    lines.push("- (none open)");
  } else {
    for (const c of openCommitments) {
      lines.push(`- ${c.due_date} · ${c.description.trim()}`);
    }
  }

  lines.push("");
  lines.push("Owned Quarterly Priorities (title — status):");
  if (priorities.length === 0) {
    lines.push("- (none)");
  } else {
    for (const p of priorities) {
      lines.push(`- ${p.title.trim()} — ${p.status}`);
    }
  }

  lines.push("");
  lines.push("Owned goals (title — status):");
  if (goals.length === 0) {
    lines.push("- (none)");
  } else {
    for (const g of goals) {
      lines.push(`- ${g.title.trim()} — ${g.status}`);
    }
  }

  // SHAPE OF WHAT THEY ARE CARRYING, not a list of it. The open
  // commitments are already itemised above; this says how much and
  // what it clusters around, which is the thing a coach reads first
  // and the thing a count alone cannot carry.
  lines.push("");
  const themes = themesFrom(openCommitments.map((c) => c.description));
  lines.push(
    `Currently carrying ${openCommitments.length} open commitment${openCommitments.length === 1 ? "" : "s"}${
      themes.length > 0 ? `, clustered around: ${themes.join(", ")}` : ""
    }.`
  );

  lines.push("");
  lines.push(
    "Open issues they are carrying (they own an open commitment on it; attempts = commitments raised against it so far):"
  );
  if (openIssues.length === 0) {
    lines.push("- (none)");
  } else {
    for (const i of openIssues) {
      lines.push(
        `- ${i.title.trim()} — ${i.attempts} attempt${i.attempts === 1 ? "" : "s"} so far`
      );
    }
  }

  lines.push("</person_context>");
  return lines.join("\n");
}
