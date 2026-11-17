import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { usageLogger } from "@/lib/coach/usage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { compareOverall } from "@/lib/maturity/compute";
import { loadCompanyScorecard } from "@/lib/maturity/service";
import { computeAttentionForCompanies } from "@/lib/hq/attention";
import type { FacilitationReview } from "@/lib/leadership/facilitation/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { callSettings } from "@/lib/transcripts/model";
import { VOICE_CORE } from "@/lib/voice/core";
import { loadCoachingPrinciples } from "@/lib/coach/principles";

// Session Brief generator. One Anthropic call per invocation; the
// result is appended as a new row to session_briefs (never
// overwritten, so a guide's history of pre-session prep is
// preserved). Best-effort: if the Claude call errors, the caller
// gets { ok: false, message } and the UI shows an inline retry.

const DEFAULT_MODEL = "claude-sonnet-5";
// Three opening questions instead of one (Coach HQ redesign) need room.
const MAX_TOKENS = 1200;
// The last coaching call's summary, as read into the brief (0326).
const LAST_CALL_MAX_CHARS = 12000;

// COACHING NOTES (shown to the coach as "Coaching notes"; stored as
// session_briefs). Rewritten 2026-11-17 (Jason) to follow the AiMS
// coaching principles, which are read in after this prompt
// (loadCoachingPrinciples): start from what is working, the leader
// owns the thinking, the wish inside the problem, the design before
// the person, one generative question at a time. The notes are for
// the coach, not the leader. The open-commitments list it used to
// carry is gone: the card shows "Where you left off" beside it.
export const SYSTEM_PROMPT = `You write coaching notes for an AiMS coach to read in the minutes
before a coaching session with a company's leader. The notes help the
coach coach the AiMS way, as set out in the AiMS coaching principles
below: start from what is working, let the leader own the thinking,
and open with generative questions.

Write to the coach, in plain English, warm and brief. Use only what
the context blocks show; never invent a fact, a number or a motive.
Where something is not in the context, leave it out.

Write four sections in Markdown, in this order, with these exact H3
headings. If a section has nothing worth saying, say so in one
sentence rather than padding.

### What's working
Two to four sentences on strengths and wins since the last coaching
call (or in the last four weeks when there was none): commitments
kept, follow-through holding or rising, moments of appreciation or
good practice in the meetings. Name the evidence for each.

### What they set out to do
When a last coaching call is given,
start from where that call left off: what the leader said they would
do or try, and what has happened since, said plainly. Without one, use the last team meeting. Leave each item unmarked:
describe, never grade. Two to five short bullets.

### Worth exploring
One or two things the context points to, such as overdue priorities or
a dip in follow-through. Frame each as the wish inside the problem
(what the leader wants instead) and look first at how the work is set
up (roles, priorities, decision rights, measures) before any person.
Offer each as an invitation for the coach, never a critique. Raise
nothing the context doesn't show.

### Questions to open with
A numbered list of exactly three generative questions the coach could
ask in the first minutes. Each asks one thing, in one sentence, and
starts from a strength, a success or what the leader wants. At least
one invites a story about a time things went well.

${VOICE_CORE}`;

export type SessionBriefResult =
  | { ok: true; briefId: string; content: string }
  | { ok: false; message: string };

// Assemble the context block from live reads, then send one call.
export async function generateSessionBrief(
  companyId: string,
  generatedByProfileId: string
): Promise<SessionBriefResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      message:
        "Session Brief isn't configured on this server (missing API key). Ask your platform admin.",
    };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  // ---- Gather context ----
  const [
    { data: company },
    { data: latestMeeting },
    scorecard,
    attentionAll,
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .maybeSingle<{ id: string; name: string }>(),
    supabase
      .from("meetings")
      .select("id, meeting_title, file_name, created_at")
      .eq("company_id", companyId)
      // The last TEAM meeting, never a coaching call (0326).
      .eq("kind", "team")
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        meeting_title: string | null;
        file_name: string;
        created_at: string;
      }>(),
    loadCompanyScorecard(companyId).catch(() => null),
    computeAttentionForCompanies([companyId]),
  ]);
  if (!company) {
    return { ok: false, message: "That company doesn't exist." };
  }

  // THE LAST COACHING CALL (0326). The one place a coaching call is
  // read outside its own page: the coach's brief starts where their last
  // call left off (Jason, 2026-11-16). Read on the caller's own client,
  // so only the company's coaches get it: an unassigned system admin
  // preparing a brief from a coach's HQ is refused the row by RLS and
  // gets a brief without it. The summary only, never the transcript.
  const { data: lastCall } = await supabase
    .from("meetings")
    .select("id, meeting_title, file_name, created_at")
    .eq("company_id", companyId)
    .eq("kind", "coaching")
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; meeting_title: string | null; file_name: string; created_at: string }>();
  let lastCallSummary: string | null = null;
  if (lastCall) {
    // meetings-kind: keyed by the coaching-call read above.
    const { data: callAnalysis } = await supabase
      .from("meeting_analyses")
      .select("analysis_markdown")
      .eq("meeting_id", lastCall.id)
      .maybeSingle<{ analysis_markdown: string | null }>();
    lastCallSummary = callAnalysis?.analysis_markdown?.slice(0, LAST_CALL_MAX_CHARS) ?? null;
  }

  let analysisMarkdown: string | null = null;
  let facilitationReview: FacilitationReview | null = null;
  let commitmentsSinceMeeting: Array<{
    owner: string | null;
    description: string;
    status: string;
    due_date: string;
  }> = [];

  if (latestMeeting) {
    // meetings-kind: keyed by the team-only read above.
    const { data: analysis } = await supabase
      .from("meeting_analyses")
      .select("analysis_markdown, facilitation_review_json")
      .eq("meeting_id", latestMeeting.id)
      .maybeSingle<{
        analysis_markdown: string | null;
        facilitation_review_json: FacilitationReview | null;
      }>();
    analysisMarkdown = analysis?.analysis_markdown ?? null;
    facilitationReview = analysis?.facilitation_review_json ?? null;

    const { data: commRows } = await supabase
      .from("commitments")
      .select("description, status, due_date, owner_id, created_at")
      .eq("company_id", companyId)
      .gte("created_at", latestMeeting.created_at)
      .is("deleted_at", null)
      .is("parked_at", null)
      .order("due_date", { ascending: true });
    const ownerIds = Array.from(
      new Set(
        ((commRows ?? []) as Array<{ owner_id: string | null }>)
          .map((c) => c.owner_id)
          .filter((x): x is string => Boolean(x))
      )
    );
    const nameById = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ownerIds);
      for (const p of (profiles ?? []) as Array<{
        id: string;
        full_name: string;
      }>) {
        nameById.set(p.id, p.full_name);
      }
    }
    commitmentsSinceMeeting = ((commRows ?? []) as Array<{
      description: string;
      status: string;
      due_date: string;
      owner_id: string | null;
    }>).map((c) => ({
      owner: c.owner_id ? nameById.get(c.owner_id) ?? null : null,
      description: c.description,
      status: c.status,
      due_date: c.due_date,
    }));
  }

  // Scorecard delta: current vs most recent prior snapshot.
  //
  // Compared over the disciplines both points scored, not by
  // subtracting the two headline overalls. A guide reads this line
  // minutes before a coaching session and quotes the number back to
  // the leader, so "down 1.1 since Sunday" has to mean a real decline
  // rather than the stored snapshot covering a different set of
  // disciplines than today's live score. See compareOverall.
  let scorecardBlock = "No scorecard snapshot available yet.";
  if (scorecard && scorecard.overall.score !== null) {
    const priorSnap =
      scorecard.overallTimeseries[scorecard.overallTimeseries.length - 1];
    const comparison = priorSnap
      ? compareOverall(priorSnap.scores, scorecard.disciplines)
      : null;
    if (priorSnap && comparison) {
      const arrow =
        comparison.delta > 0 ? "up" : comparison.delta < 0 ? "down" : "flat";
      scorecardBlock =
        `Overall ${comparison.now}/10 (${arrow} ${Math.abs(comparison.delta)} ` +
        `vs ${priorSnap.date} snapshot of ${comparison.then}/10, ` +
        `across the ${comparison.disciplinesCompared} disciplines scored on both).`;
    } else {
      scorecardBlock = `Overall ${scorecard.overall.score}/10 (no prior snapshot yet).`;
    }
  }

  const attention = attentionAll[0];
  const attentionBlock = attention
    ? attention.triggers.map((t) => `- ${JSON.stringify(t)}`).join("\n")
    : "(none)";

  const contextBlocks: string[] = [];
  contextBlocks.push(`## Company\n${company.name}`);
  if (latestMeeting) {
    contextBlocks.push(
      `## Last meeting\n${
        latestMeeting.meeting_title ?? latestMeeting.file_name
      } (${new Date(latestMeeting.created_at).toISOString().slice(0, 10)})`
    );
  }
  if (analysisMarkdown) {
    contextBlocks.push(`## Last meeting analysis\n${analysisMarkdown}`);
  }
  if (facilitationReview) {
    const growthEdges = (facilitationReview.growth_edges ?? [])
      .map(
        (g, i) =>
          `${i + 1}. [${g.dimension}] ${g.title}${
            g.evidence ? ` — ${g.evidence}` : ""
          }`
      )
      .join("\n");
    contextBlocks.push(
      `## Facilitation growth edges\n${growthEdges || "(none)"}`
    );
    if (Array.isArray(facilitationReview.appreciation_moments)) {
      contextBlocks.push(
        `## Appreciation moments\n${facilitationReview.appreciation_moments
          .map((m) => `- ${m.quote} (${m.context})`)
          .join("\n") || "(none)"}`
      );
    }
  }
  if (commitmentsSinceMeeting.length > 0) {
    contextBlocks.push(
      `## Commitments since last meeting\n${commitmentsSinceMeeting
        .map(
          (c) =>
            `- ${c.description} — ${c.owner ?? "unassigned"} — ${
              c.status
            } — due ${c.due_date}`
        )
        .join("\n")}`
    );
  }
  if (lastCall && lastCallSummary) {
    contextBlocks.push(
      `## Last coaching call\n${lastCall.meeting_title ?? lastCall.file_name} (${new Date(lastCall.created_at)
        .toISOString()
        .slice(0, 10)})\n\n${lastCallSummary}`
    );
  }
  contextBlocks.push(`## Scorecard\n${scorecardBlock}`);
  contextBlocks.push(`## Attention queue\n${attentionBlock}`);

  const userMessage = contextBlocks.join("\n\n");

  // ---- One Anthropic call ----
  const model = process.env.ANTHROPIC_COACH_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });
  let content: string;
  try {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      ...callSettings(model, "off"),
      system: `${SYSTEM_PROMPT}\n\n# The AiMS coaching principles the coach works by\n\n${await loadCoachingPrinciples()}`,
      messages: [{ role: "user", content: userMessage }],
    });
    usageLogger({ companyId, purpose: "session_brief", model })(response);
    content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!content) {
      return {
        ok: false,
        message: "The coaching notes came back empty. Try again.",
      };
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Unknown error generating brief.";
    return { ok: false, message: msg };
  }

  // ---- Append the row ----
  const { data: inserted, error: insertError } = await supabase
    .from("session_briefs")
    .insert({
      company_id: companyId,
      generated_by: generatedByProfileId,
      content_markdown: content,
      // The coaching call when the brief read one (0326), so the brief
      // is shown only to people who can read that call (briefsVisible).
      based_on_meeting_id: (lastCall && lastCallSummary ? lastCall.id : latestMeeting?.id) ?? null,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (insertError || !inserted) {
    return {
      ok: false,
      message: insertError?.message ?? "Couldn't save the brief.",
    };
  }

  return { ok: true, briefId: inserted.id, content };
}

// Read the two most recent briefs a caller can see for a company.
// The RLS policy admits sysadmin (any brief) or (generated_by = self
// AND has assignment). Sorted newest-first.
export type SessionBriefRow = {
  id: string;
  company_id: string;
  generated_by: string;
  content_markdown: string;
  based_on_meeting_id: string | null;
  created_at: string;
};

export async function loadRecentBriefs(
  companyId: string,
  limit = 2
): Promise<SessionBriefRow[]> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await supabase
    .from("session_briefs")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit + 5);
  return (await briefsVisible(supabase, (data ?? []) as SessionBriefRow[])).slice(0, limit);
}

// A BRIEF THAT READ A COACHING CALL IS SHOWN ONLY TO ITS READERS (0326).
// Its based_on_meeting_id is that call. session_briefs' read rule admits
// every system admin, and a system admin can open a coach's HQ, so a
// brief whose meeting the viewer cannot read (RLS hides a coaching call
// from all but the company's coaches and champion) is left out. A brief
// on a team meeting, or on none, is unaffected.
async function briefsVisible(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  rows: SessionBriefRow[]
): Promise<SessionBriefRow[]> {
  const ids = [...new Set(rows.map((r) => r.based_on_meeting_id).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return rows;
  // meetings-kind: either kind, on purpose: what the viewer can read of
  // these ids decides which briefs they see.
  const { data } = await supabase.from("meetings").select("id").in("id", ids);
  const readable = new Set(((data ?? []) as Array<{ id: string }>).map((m) => m.id));
  return rows.filter((r) => !r.based_on_meeting_id || readable.has(r.based_on_meeting_id));
}
