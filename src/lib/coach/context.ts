import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { todayInTimezone } from "@/lib/dates";
import { computeFollowThroughRate } from "@/lib/utils";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { SUB_STRENGTH_LABELS } from "@/lib/strengths/types";
import type { ResultsProfile } from "@/lib/strengths/types";
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
};

export type CoachContextBlocks = {
  companyContext: string;
  // Null in general mode.
  personContext: string | null;
  // Null when the subject has no strengths or the mode is general.
  strengthsContext: string | null;
  coachingContext: string;
  mode: "about" | "general";
};

export async function buildCoachContext(
  input: CoachContextInput
): Promise<CoachContextBlocks> {
  const supabase = await createSupabaseServerClient();

  // Company-level fetches always run. Subject-scoped fetches only
  // run in about-mode — in general mode they'd be pointless and
  // could pull data the coach must not touch.
  const [
    { data: company },
    { data: foundation },
    { data: foundationItems },
    subjectBundle,
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
    input.subjectProfileId
      ? loadSubjectBundle(supabase, input.companyId, input.subjectProfileId)
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
    // General mode — Ask Aimee. No subject; no person, keep-rate, or
    // strengths context. The coach relies on what the user shares
    // in-thread, plus the company context above.
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
      strengthsContext: null,
      coachingContext,
      mode,
    };
  }

  const { subject, openQuarter, keepRatesByQuarter, commitmentStats, plan, strengthsContext } =
    subjectBundle;
  const { keptCount, missedCount, missed, openCommitments } = commitmentStats;

  const personContext = formatPersonContext({
    subject,
    todayIso,
    keepRatesByQuarter,
    openQuarter,
    keptCount,
    missedCount,
    missed,
    openCommitments,
    priorities: plan.priorities,
    goals: plan.goals,
  });

  const coachingContext = [
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

  return { companyContext, personContext, strengthsContext, coachingContext, mode };
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
  keptCount: number;
  missedCount: number;
  missed: Array<Pick<Commitment, "description" | "missed_reason" | "week_ending" | "due_date">>;
  openCommitments: Array<Pick<Commitment, "description" | "due_date" | "week_ending">>;
}> {
  const missed: Array<Pick<Commitment, "description" | "missed_reason" | "week_ending" | "due_date">> = [];
  let keptCount = 0;
  let missedCount = 0;

  if (openQuarter) {
    const { data } = await supabase
      .from("commitments")
      .select("description, status, missed_reason, week_ending, due_date")
      .eq("owner_id", subjectId)
      .gte("week_ending", openQuarter.start_date)
      .lte("week_ending", openQuarter.end_date);
    const rows = (data ?? []) as Array<
      Pick<Commitment, "description" | "status" | "missed_reason" | "week_ending" | "due_date">
    >;
    for (const row of rows) {
      if (row.status === "kept") keptCount += 1;
      else if (row.status === "missed") {
        missedCount += 1;
        missed.push({
          description: row.description,
          missed_reason: row.missed_reason,
          week_ending: row.week_ending,
          due_date: row.due_date,
        });
      }
    }
  }

  const { data: openRows } = await supabase
    .from("commitments")
    .select("description, due_date, week_ending")
    .eq("owner_id", subjectId)
    .eq("status", "open")
    .order("due_date", { ascending: true });
  const openCommitments = (openRows ?? []) as Array<
    Pick<Commitment, "description" | "due_date" | "week_ending">
  >;

  return { keptCount, missedCount, missed, openCommitments };
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
  keptCount,
  missedCount,
  missed,
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
  keptCount: number;
  missedCount: number;
  missed: Array<Pick<Commitment, "description" | "missed_reason" | "week_ending" | "due_date">>;
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
  lines.push("Follow-through rate by quarter (most recent first):");
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
      `This quarter (${openQuarter.label}) — kept: ${keptCount}, closed (missed): ${missedCount}.`
    );
  } else {
    lines.push("This quarter: no open quarter.");
  }

  lines.push("");
  lines.push("Every closed-late (missed) commitment this quarter, verbatim reason:");
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
