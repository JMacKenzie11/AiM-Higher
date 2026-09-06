import "server-only";

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logCoachTokenUsage } from "@/lib/coach/usage";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Nightly per-conversation analysis job — Pass 2 feed for the
// Coaching insights card.
//
// For each coaching_conversation without a matching row in
// coaching_conversation_analyses AND with at least one user turn,
// send the transcript to Haiku with a strict PII-strip prompt and
// store a small structured summary (topics, friction, opportunity).
// The dashboard reads those rows and aggregates in JS at read time
// — no on-demand LLM call needed to refresh a filter view.
//
// Bounded compute: BATCH_LIMIT keeps a single run cheap and
// predictable. New chats analyzed the next night are perfectly
// fine — this data feeds a slow-moving analytics surface, not a
// realtime view.
//
// Cron wire-up lives in vercel.json.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-haiku-4-5";
const PROMPT_VERSION = 1;
const BATCH_LIMIT = 40;
// Cap transcript payload so a runaway thread can't blow the token
// budget for one row. Ten most-recent messages + 800 chars each is
// plenty of signal for a summary + topic tags.
const MAX_MSGS_PER_CONVO = 10;
const MAX_CHARS_PER_MSG = 800;

type AnalysisPayload = {
  summary: string;
  topics: string[];
  friction_level: 0 | 1 | 2 | 3;
  friction_signal: string | null;
  opportunity: string | null;
};

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

async function handle(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response("ANTHROPIC_API_KEY not configured", { status: 500 });
  }

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());

  // Pull the analysis-row IDs we already have so the outer query
  // can exclude them. Doing this in-JS keeps the SELECT simple
  // (PostgREST NOT-IN via a subquery is awkward).
  const { data: existingRows } = await admin
    .from("coaching_conversation_analyses")
    .select("conversation_id")
    .eq("prompt_version", PROMPT_VERSION);
  const analyzedIds = new Set(
    ((existingRows ?? []) as Array<{ conversation_id: string }>).map(
      (r) => r.conversation_id
    )
  );

  // Candidate conversations: newest-first so a busy day gets
  // covered before a backlog dominates the batch.
  const { data: convosData } = await admin
    .from("coaching_conversations")
    .select("id, company_id, practice_id, created_at")
    .order("updated_at", { ascending: false })
    .limit(BATCH_LIMIT * 4);
  const candidates = ((convosData ?? []) as Array<{
    id: string;
    company_id: string;
    practice_id: string | null;
    created_at: string;
  }>).filter((c) => !analyzedIds.has(c.id));

  if (candidates.length === 0) {
    return Response.json({
      status: "ok",
      analyzed: 0,
      reason: "backlog is empty",
    });
  }

  const batch = candidates.slice(0, BATCH_LIMIT);

  // Pull messages for the batch in one query, group per convo.
  const { data: msgsData } = await admin
    .from("coaching_messages")
    .select("conversation_id, role, content, created_at")
    .in(
      "conversation_id",
      batch.map((c) => c.id)
    )
    .order("created_at", { ascending: true });
  const msgsByConvo = new Map<
    string,
    Array<{ role: string; content: string }>
  >();
  for (const m of (msgsData ?? []) as Array<{
    conversation_id: string;
    role: string;
    content: string;
    created_at: string;
  }>) {
    const arr = msgsByConvo.get(m.conversation_id) ?? [];
    arr.push({ role: m.role, content: m.content });
    msgsByConvo.set(m.conversation_id, arr);
  }

  const client = new Anthropic({ apiKey });
  let analyzed = 0;
  let skipped = 0;
  let errored = 0;

  for (const c of batch) {
    const msgs = msgsByConvo.get(c.id) ?? [];
    const userTurns = msgs.filter((m) => m.role === "user");
    if (userTurns.length === 0) {
      skipped += 1;
      continue;
    }
    // Take the last N messages so long threads still fit; a decisive
    // moment usually lands near the end.
    const tail = msgs.slice(-MAX_MSGS_PER_CONVO);
    const transcript = tail
      .map(
        (m) =>
          `${m.role.toUpperCase()}: ${m.content.slice(0, MAX_CHARS_PER_MSG)}`
      )
      .join("\n");

    try {
      const payload = await analyzeOne(client, transcript);
      const { error: insertErr } = await admin
        .from("coaching_conversation_analyses")
        .insert({
          conversation_id: c.id,
          company_id: c.company_id,
          practice_id: c.practice_id,
          summary: payload.summary,
          topics: payload.topics,
          friction_level: payload.friction_level,
          friction_signal: payload.friction_signal,
          opportunity: payload.opportunity,
          model: MODEL,
          prompt_version: PROMPT_VERSION,
        });
      if (insertErr) {
        console.error("coaching-insights cron: insert failed", {
          convoId: c.id,
          err: insertErr,
        });
        errored += 1;
      } else {
        analyzed += 1;
      }
    } catch (err) {
      console.error("coaching-insights cron: analyze failed", {
        convoId: c.id,
        err,
      });
      errored += 1;
    }
  }

  return Response.json({
    status: "ok",
    candidates: candidates.length,
    analyzed,
    skipped,
    errored,
  });
}

// PII-stripping + structured extraction. One Haiku call per convo.
// The response is JSON-only; any parse failure is treated as a hard
// error so we don't insert garbage.
async function analyzeOne(
  client: Anthropic,
  transcript: string
): Promise<AnalysisPayload> {
  const prompt = `You are analyzing a workplace leadership coaching conversation. Return a structured summary suitable for cross-tenant reporting.

PII RULE (non-negotiable): Replace every proper noun that could identify a person, company, product, or location with a generic role term:
- People: "the leader", "a report", "a peer", "a manager", "a stakeholder", "a client"
- Companies: "the company", "a supplier", "a customer"
- Products: "the product", "a competing product"
- Locations: "the region", "a site"
If a name still appears in your output, you failed. Re-read before returning.

Return ONLY a JSON object matching this schema — no code fences, no prose:
{
  "summary": "one plain sentence: what the leader was working on",
  "topics": ["1-4 short tags in plain business language"],
  "friction_level": 0,
  "friction_signal": null,
  "opportunity": null
}

friction_level scale:
 0 = informational / neutral (asking a question, exploring)
 1 = mild friction (some tension but making progress)
 2 = frustrated (stuck on a specific issue, expressing frustration)
 3 = stuck (repeated attempts, blocked, escalated)

friction_signal: if level >= 1, a short phrase naming the friction (e.g. "unclear priorities", "accountability gap"). Otherwise null.

opportunity: if the conversation surfaces a platform-product opportunity (a feature that would help), a short phrase. Otherwise null.

topics: 1-4 short tags in plain business language — not therapy-speak, not consultant jargon.

Transcript:
${transcript}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  if (response.usage) {
    void logCoachTokenUsage({
      conversationId: null,
      companyId: null,
      purpose: "insights_analysis",
      model: MODEL,
      usage: response.usage,
    });
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const parsed = JSON.parse(stripCodeFence(text)) as Partial<AnalysisPayload>;
  if (typeof parsed.summary !== "string" || parsed.summary.length === 0) {
    throw new Error("analyzeOne: missing summary");
  }
  if (!Array.isArray(parsed.topics)) {
    throw new Error("analyzeOne: missing topics");
  }
  const topics = parsed.topics
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .slice(0, 4);
  const rawLevel =
    typeof parsed.friction_level === "number" ? parsed.friction_level : 0;
  const friction_level = (Math.max(0, Math.min(3, Math.round(rawLevel))) as
    | 0
    | 1
    | 2
    | 3);
  const friction_signal =
    friction_level > 0 && typeof parsed.friction_signal === "string"
      ? parsed.friction_signal.trim().slice(0, 120) || null
      : null;
  const opportunity =
    typeof parsed.opportunity === "string" && parsed.opportunity.trim().length > 0
      ? parsed.opportunity.trim().slice(0, 200)
      : null;

  return {
    summary: parsed.summary.trim().slice(0, 500),
    topics,
    friction_level,
    friction_signal,
    opportunity,
  };
}

// Haiku (and Sonnet) will wrap JSON in ```json ... ``` fences
// even when the prompt says not to. Strip them defensively so a
// single ignored instruction doesn't nuke the whole batch.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpen = trimmed
    .replace(/^```(?:json|JSON)?\s*/, "")
    .replace(/```$/, "");
  return withoutOpen.trim();
}
