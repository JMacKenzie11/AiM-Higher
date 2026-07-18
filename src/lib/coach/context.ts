import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { todayInTimezone } from "@/lib/dates";
import type {
  AnnualGoal,
  Commitment,
  CompanyFoundation,
  FoundationItem,
  Priority,
  Profile,
  Quarter,
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
  subjectProfileId: string;
  currentAdminName: string;
  currentAdminProfileId: string;
  // Which module owns this conversation. Determines how the person
  // context block is built. Defaults to execution.
  contextKind?: "execution" | "strengths";
};

export type CoachContextBlocks = {
  companyContext: string;
  personContext: string;
  coachingContext: string;
  isSelfCoaching: boolean;
};

export async function buildCoachContext(
  input: CoachContextInput
): Promise<CoachContextBlocks> {
  const supabase = await createSupabaseServerClient();

  const [
    { data: company },
    { data: foundation },
    { data: foundationItems },
    { data: subject },
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
    supabase
      .from("profiles")
      .select("id, full_name, position, role, company_id")
      .eq("id", input.subjectProfileId)
      .maybeSingle<
        Pick<Profile, "id" | "full_name" | "position" | "role" | "company_id">
      >(),
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

  const requestedKind = input.contextKind ?? "execution";
  // Entitlement gate: if the company doesn't have the strengths
  // module (either never had it, or turned it off), don't feed
  // strengths data into the coaching prompt even if an old
  // conversation was created under that kind. Fall through to
  // execution context so the session degrades gracefully.
  const kind =
    requestedKind === "strengths" &&
    !(await companyHasFeature(input.companyId, "strengths"))
      ? "execution"
      : requestedKind;

  let personContext: string;
  if (kind === "strengths") {
    // Strengths context: latest completed assessment for the subject,
    // plus its results block and narrative transcript. If they
    // haven't finished one yet the block is a graceful note so the
    // model can still coach in general terms.
    const { data: assessmentRow } = await supabase
      .from("strengths_assessments")
      .select("id, completed_at")
      .eq("user_id", input.subjectProfileId)
      .eq("status", "completed")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; completed_at: string | null }>();

    let resultsJson: unknown = null;
    let resultsSummary: string | null = null;
    let narrativeTranscript = "";

    if (assessmentRow) {
      const [{ data: resultRow }, { data: narrativeRows }] = await Promise.all([
        supabase
          .from("strengths_results")
          .select("profile, summary")
          .eq("assessment_id", assessmentRow.id)
          .maybeSingle<{ profile: unknown; summary: string }>(),
        supabase
          .from("strengths_narrative_messages")
          .select("role, content")
          .eq("assessment_id", assessmentRow.id)
          .order("created_at", { ascending: true }),
      ]);
      resultsJson = resultRow?.profile ?? null;
      resultsSummary = resultRow?.summary ?? null;
      narrativeTranscript =
        ((narrativeRows ?? []) as Array<{ role: string; content: string }>)
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n") || "";
    }

    const lines: string[] = ["<person_context>"];
    lines.push(`Name: ${subject?.full_name ?? "(unknown)"}`);
    lines.push(`Position: ${subject?.position ?? "—"}`);
    lines.push(`Today: ${todayIso}`);
    lines.push("");
    if (!assessmentRow) {
      lines.push(
        "Assessment: not yet completed. Coach in the general AiMS strengths voice and invite them to describe what's showing up for them."
      );
    } else {
      lines.push(
        `Assessment completed: ${
          assessmentRow.completed_at?.slice(0, 10) ?? "(recently)"
        }`
      );
      if (resultsSummary) {
        lines.push("");
        lines.push("Written summary:");
        lines.push(resultsSummary.trim());
      }
      if (resultsJson) {
        lines.push("");
        lines.push("Structured results:");
        lines.push(JSON.stringify(resultsJson));
      }
      if (narrativeTranscript) {
        lines.push("");
        lines.push("Best-self narrative transcript:");
        lines.push(narrativeTranscript);
      }
    }
    lines.push("</person_context>");
    personContext = lines.join("\n");
  } else {
    // openQuarter is needed to bucket loadSubjectCommitments; everything
    // else in this branch can run concurrently against it.
    const [openQuarter, priorQuarters, { priorities, goals }] = await Promise.all([
      getCurrentQuarter(input.companyId),
      loadPriorQuarters(supabase, input.companyId, 2),
      loadOwnedPlanItems(supabase, input.subjectProfileId),
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
            input.companyId,
            input.subjectProfileId,
            q
          ),
        }))
      ),
      loadSubjectCommitments(supabase, input.subjectProfileId, openQuarter),
    ]);
    const { keptCount, missedCount, missed, openCommitments } = commitmentStats;

    personContext = formatPersonContext({
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
    });
  }

  const isSelfCoaching = subject?.id === input.currentAdminProfileId;
  const coachingContext = [
    "<coaching_context>",
    `Being coached about: ${subject?.full_name ?? "(unknown subject)"}`,
    `Coaching participant: ${input.currentAdminName}`,
    isSelfCoaching
      ? "This is a self-coaching session — the participant is reflecting on their own execution, not someone else's. Address them in the second person ('you' / 'your'), not the third person."
      : "This is a leadership coaching session about another person. Refer to the subject by their name.",
    "Pronouns for the subject are unknown. Use they/them by default; never infer gender from names. If you use a name repeatedly, that's fine — just do not guess pronouns.",
    `Today: ${todayIso}`,
    "</coaching_context>",
  ].join("\n");

  return { companyContext, personContext, coachingContext, isSelfCoaching };
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
  let kept = 0;
  let missed = 0;
  for (const r of rows) {
    if (r.status === "kept") kept += 1;
    else if (r.status === "missed") missed += 1;
  }
  const denom = kept + missed;
  if (denom === 0) return null;
  return Math.round((kept / denom) * 100);
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
  lines.push("Owned priorities (title — status):");
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
