import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadCompanyScorecard } from "@/lib/maturity/service";
import { computeAttentionForCompanies } from "@/lib/hq/attention";
import type { FacilitationReview } from "@/lib/leadership/facilitation/types";

// Session Brief generator. One Anthropic call per invocation; the
// result is appended as a new row to session_briefs (never
// overwritten, so a guide's history of pre-session prep is
// preserved). Best-effort: if the Claude call errors, the caller
// gets { ok: false, message } and the UI shows an inline retry.

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 800;

const SYSTEM_PROMPT = `You are the AiMS coaching prep assistant. You produce a short structured
brief a guide reads right before a coaching session. Ground everything
in the context blocks provided; do not invent facts. Voice is warm,
generative, forward-leaning — never deficit-focused.

Output four short sections in Markdown, in this exact order and with
these exact H3 headings. If a section has no material worth writing,
say so in a single sentence rather than padding.

### What happened last time
Two to four sentences summarizing the last meeting's shape and any
appreciative moments. Reference the meeting date if you know it.

### What's still open
A short bulleted list of the open commitments this company is still
working through, grouped by owner when useful.

### Growth edges worth raising
One or two coaching prompts, drawn from the facilitation review's
growth edges and any attention-queue signals. Frame each as a
question or an invitation, not a critique.

### Suggested opening question
One question that lands the guide in an appreciative, curious posture
for the first two minutes of the session.`;

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

  const supabase = await createSupabaseServerClient();

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

  let analysisMarkdown: string | null = null;
  let facilitationReview: FacilitationReview | null = null;
  let commitmentsSinceMeeting: Array<{
    owner: string | null;
    description: string;
    status: string;
    due_date: string;
  }> = [];

  if (latestMeeting) {
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
  let scorecardBlock = "No scorecard snapshot available yet.";
  if (scorecard && scorecard.overall.score !== null) {
    const priorSnap =
      scorecard.overallTimeseries[scorecard.overallTimeseries.length - 1];
    if (priorSnap && priorSnap.score !== null) {
      const delta = scorecard.overall.score - priorSnap.score;
      const arrow = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
      scorecardBlock = `Overall ${scorecard.overall.score}/10 (${arrow} ${Math.abs(
        Math.round(delta * 10) / 10
      )} vs ${priorSnap.date} snapshot of ${priorSnap.score}/10).`;
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
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
    content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!content) {
      return {
        ok: false,
        message: "The model returned an empty brief. Try again.",
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
      based_on_meeting_id: latestMeeting?.id ?? null,
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
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("session_briefs")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as SessionBriefRow[];
}

// Batch variant for the /hq page — one round-trip fetches recent
// briefs for every caseload company at once, then partitions in
// memory. Returns a map keyed by company_id, newest-first, capped at
// `limit` per company. Prior implementation called loadRecentBriefs
// N times in parallel — harmless for small caseloads but N round
// trips still cost a fixed per-request latency floor.
export async function loadRecentBriefsForCompanies(
  companyIds: string[],
  limit = 2
): Promise<Map<string, SessionBriefRow[]>> {
  const out = new Map<string, SessionBriefRow[]>();
  if (companyIds.length === 0) return out;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("session_briefs")
    .select("*")
    .in("company_id", companyIds)
    .order("company_id", { ascending: true })
    .order("created_at", { ascending: false });
  for (const row of (data ?? []) as SessionBriefRow[]) {
    const list = out.get(row.company_id) ?? [];
    if (list.length < limit) list.push(row);
    out.set(row.company_id, list);
  }
  return out;
}
