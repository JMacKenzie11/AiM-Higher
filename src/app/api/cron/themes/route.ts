import "server-only";

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logCoachTokenUsage } from "@/lib/coach/usage";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Nightly themes-clustering job. Loads the most recent N coaching
// conversations across the platform, feeds their auto-titles and
// the first user message into Haiku, and stores the resulting
// five themes into coach_theme_snapshot for the system-admin
// dashboard to read.
//
// Cheap by design — one small Haiku call per night, capped input
// size, capped output size. Token usage is logged to
// coach_token_usage with purpose='themes' so it shows up in the
// dashboard's cost card alongside the coach's own spend.
//
// Vercel cron entry lives in vercel.json.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const SAMPLE_LIMIT = 200;
const MODEL = "claude-haiku-4-5";

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

  // Sample the most recent conversations with a title (skip the
  // default "Coaching · Aug 10" placeholders since they carry no
  // topic signal). Practice conversations are included — the
  // practice title alone is a fine signal for "what did they work
  // on."
  const { data: convosData } = await admin
    .from("coaching_conversations")
    .select("id, title, practice_id")
    .not("title", "ilike", "Coaching · %")
    .not("title", "ilike", "___ __") // matches "Aug 10" bare dates
    .order("updated_at", { ascending: false })
    .limit(SAMPLE_LIMIT);
  const convos = (convosData ?? []) as Array<{
    id: string;
    title: string;
    practice_id: string | null;
  }>;

  if (convos.length === 0) {
    return Response.json({
      status: "skipped",
      reason: "no titled conversations to cluster",
    });
  }

  // Grab the first user message from each conversation as extra
  // context beyond the title. Cap the message excerpt so the total
  // input stays cheap.
  const convoIds = convos.map((c) => c.id);
  const { data: msgsData } = await admin
    .from("coaching_messages")
    .select("conversation_id, content, created_at, role")
    .in("conversation_id", convoIds)
    .eq("role", "user")
    .order("created_at", { ascending: true });
  const firstByConvo = new Map<string, string>();
  for (const m of (msgsData ?? []) as Array<{
    conversation_id: string;
    content: string;
    created_at: string;
    role: string;
  }>) {
    if (!firstByConvo.has(m.conversation_id)) {
      firstByConvo.set(m.conversation_id, m.content.slice(0, 240));
    }
  }

  const lines = convos.map((c, i) => {
    const first = firstByConvo.get(c.id);
    const practice = c.practice_id ? ` [practice: ${c.practice_id}]` : "";
    const excerpt = first ? ` — ${first}` : "";
    return `${i + 1}. ${c.title}${practice}${excerpt}`;
  });

  const client = new Anthropic({ apiKey });
  const prompt = `You will cluster a list of workplace coaching conversations into the top 5 themes.

Rules:
- Return EXACTLY 5 themes covering the largest share of the input.
- Each theme label is 2-4 plain words a business owner would use out loud.
- Each description is one sentence: what leaders are working on when they open this kind of conversation.
- No therapy-speak, no consultant jargon, no metaphors. Say the literal thing.
- Do not include a "miscellaneous" or "other" theme; force the fifth-most-common theme even if it is small.

Return ONLY a JSON object with this exact shape (no code fences, no prose):
{
  "themes": [
    { "label": "string", "count": integer, "description": "string" }
  ]
}

Where "count" is your best estimate of how many of the input conversations fit each theme.

Input (${convos.length} conversations):
${lines.join("\n")}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    messages: [{ role: "user", content: prompt }],
  });

  // Log cost even if parsing fails below — we still burned tokens.
  if (response.usage) {
    void logCoachTokenUsage({
      conversationId: null,
      companyId: null,
      purpose: "themes",
      model: MODEL,
      usage: response.usage,
    });
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  type ThemeItem = { label: string; count: number; description: string };
  let themes: ThemeItem[] = [];
  try {
    const parsed = JSON.parse(text) as { themes?: unknown };
    if (Array.isArray(parsed.themes)) {
      themes = parsed.themes
        .filter(
          (t: unknown): t is ThemeItem =>
            typeof t === "object" &&
            t !== null &&
            typeof (t as { label?: unknown }).label === "string" &&
            typeof (t as { count?: unknown }).count === "number" &&
            typeof (t as { description?: unknown }).description === "string"
        )
        .slice(0, 5);
    }
  } catch (err) {
    console.error("themes cron: JSON parse failed", { text, err });
    return new Response(
      JSON.stringify({ status: "error", reason: "model returned invalid JSON" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  if (themes.length === 0) {
    return Response.json({
      status: "error",
      reason: "no valid themes parsed",
    });
  }

  const { error } = await admin.from("coach_theme_snapshot").insert({
    themes,
    source_count: convos.length,
    model: MODEL,
  });
  if (error) {
    console.error("themes cron: insert failed", error);
    return new Response(
      JSON.stringify({ status: "error", reason: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return Response.json({
    status: "ok",
    themesWritten: themes.length,
    sourceCount: convos.length,
    themes: themes.map((t) => ({ label: t.label, count: t.count })),
  });
}
