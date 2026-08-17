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
  const supabase = await createSupabaseServerClient();

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
      personContext: null,
      partnerContext: null,
      strengthsContext: null,
      coachingContext,
      mode,
    };
  }

  const { subject, openQuarter, keepRatesByQuarter, commitmentStats, plan, strengthsContext } =
    subjectBundle;
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
      .select("id, full_name, position, role, company_id")
      .eq("id", subjectProfileId)
      .maybeSingle<
        Pick<Profile, "id" | "full_name" | "position" | "role" | "company_id">
      >(),
    getCurrentQuarter(companyId),
    loadPriorQuarters(supabase, companyId, 2),
    loadOwnedPlanItems(supabase, subjectProfileId),
    buildStrengthsContext({ supabase, subjectProfileId, companyId }),
  ]);

  const quartersForRate = [openQuarter, ...priorQuarters].filter(
    (q): q is Quarter => Boolean(q)
  );

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

  return {
    subject,
    openQuarter,
    keepRatesByQuarter,
    commitmentStats,
    plan,
    strengthsContext,
  };
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

function formatPersonContext({
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
  lines.push("Owned 90-Day Priorities (title — status):");
  if (priorities.length === 0) {
    lines.push("- (none)");
  } else {
    for (const p of priorities) {
      lines.push(`- ${p.title.trim()} — ${p.status}`);
    }
  }

  lines.push("");
  lines.push("Owned annual goals (title — status):");
  if (goals.length === 0) {
    lines.push("- (none)");
  } else {
    for (const g of goals) {
      lines.push(`- ${g.title.trim()} — ${g.status}`);
    }
  }

  lines.push("</person_context>");
  return lines.join("\n");
}
