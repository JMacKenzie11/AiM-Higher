import "server-only";

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logCoachTokenUsage } from "@/lib/coach/usage";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { anonymiser } from "@/lib/aimee/anonymise";
import { analyzeConversation, INSIGHTS_PROMPT_VERSION } from "@/lib/admin/insights-analysis";

// Nightly per-conversation analysis job — Pass 2 feed for the
// Coaching insights card.
//
// For each coaching_conversation without a matching row in
// coaching_conversation_analyses AND with at least one user turn,
// send the transcript to Haiku and store a small structured summary
// (topics, friction, opportunity). ANONYMOUS (Jason, 2026-10-01):
// names come out of the transcript before the model sees it, and the
// answer is checked before it is stored (aimee/anonymise.ts,
// admin/insights-analysis.ts). A conversation analysed before that
// keeps its row and is not analysed again (Jason: keep the 41).
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

// Haiku, deliberately: this runs fleet-wide on a schedule and
// the work is extraction rather than judgement.
const MODEL = "claude-haiku-4-5";
const BATCH_LIMIT = 40;
// Cap transcript payload so a runaway thread can't blow the token
// budget for one row. Ten most-recent messages + 800 chars each is
// plenty of signal for a summary + topic tags.
const MAX_MSGS_PER_CONVO = 10;
const MAX_CHARS_PER_MSG = 800;

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
  // Any version: a conversation analysed before the anonymous rule is
  // kept as it is, not analysed again.
  const { data: existingRows } = await admin
    .from("coaching_conversation_analyses")
    .select("conversation_id");
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
    // Previews excluded: an admin rehearsing a draft in the Agent
    // Hub is not usage. See migration 0229.
    .eq("is_preview", false)
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
    // An opener hidden by an agent swap (0239) was never part of the
    // conversation; the service role bypasses the policy that hides it.
    .is("hidden_at", null)
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

  // The roster and company names the transcripts are scrubbed of.
  const [{ data: people }, { data: companies }] = await Promise.all([
    admin.from("profiles").select("full_name"),
    admin.from("companies").select("name").is("deleted_at", null),
  ]);
  const anon = anonymiser({
    people: ((people ?? []) as Array<{ full_name: string | null }>).flatMap((p) => (p.full_name ? [p.full_name] : [])),
    companies: ((companies ?? []) as Array<{ name: string | null }>).flatMap((c) => (c.name ? [c.name] : [])),
  });

  const client = new Anthropic({ apiKey });
  let analyzed = 0;
  let skipped = 0;
  let errored = 0;
  let retried = 0;
  let dropped = 0;

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
    const transcript = anon.scrub(
      tail
        .map(
          (m) =>
            `${m.role.toUpperCase()}: ${m.content.slice(0, MAX_CHARS_PER_MSG)}`
        )
        .join("\n")
    );

    try {
      const result = await analyzeConversation(client, MODEL, transcript, anon, (message) => {
        if (!message.usage) return;
        void logCoachTokenUsage({
          conversationId: null,
          companyId: null,
          purpose: "insights_analysis",
          model: MODEL,
          usage: message.usage,
        });
      });
      if (result.retried) retried += 1;
      if (result.dropped.length > 0) dropped += 1;
      const payload = result.payload;
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
          prompt_version: INSIGHTS_PROMPT_VERSION,
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
    // Counts only: what was said is never logged.
    anonymity: { retried, dropped },
  });
}
