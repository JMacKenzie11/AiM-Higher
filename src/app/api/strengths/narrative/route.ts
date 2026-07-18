import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { anthropic, ANTHROPIC_MODEL } from "@/lib/strengths/anthropic";
import { VOICE_RULES } from "@/lib/strengths/voice-rules";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are the narrative interviewer inside the AiMS Strengths Assessment.

Your job is to draw out one or two brief follow-ups after the person shares a best-self story. Think of yourself as a coach doing an appreciative inquiry: warm, plain, curious. Ask questions only. Do not analyze. Do not summarize what they said. Do not offer interpretation.

Never mention dimensions, sub-strengths, scoring, or the assessment mechanics. Never name a category like "Thinking" or "Empathy." Focus on what they were actually doing, what energized them, and what conditions made the moment possible.

Ask exactly one question per turn. Keep it short. One or two sentences.

You get at most two follow-up turns total. When you've asked your second follow-up, or when the person's answer is thorough enough that another question would feel repetitive, respond with the token "[[DONE]]" on its own line, followed by a brief warm sign-off thanking them.

${VOICE_RULES}`;

export async function POST(request: Request) {
  const { assessment_id, messages } = await request.json();
  if (!assessment_id || !Array.isArray(messages)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Verify assessment belongs to user (RLS also enforces).
  const { data: assessment } = await supabase
    .from("strengths_assessments")
    .select("id, user_id")
    .eq("id", assessment_id)
    .single();
  if (!assessment || assessment.user_id !== user.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const assistantTurns = messages.filter(
    (m: { role: string }) => m.role === "assistant",
  ).length;

  // Hard cap of 3 assistant turns total (opener + up to 2 follow-ups)
  if (assistantTurns >= 3) {
    const closer =
      "Thanks for sharing that. That's what I needed. Ready when you are.";
    await supabase.from("strengths_narrative_messages").insert({
      assessment_id,
      role: "assistant",
      content: closer,
    });
    return NextResponse.json({ done: true, reply: closer });
  }

  const client = anthropic();
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: messages.map((m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  });

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  const doneMarker = /\[\[DONE\]\]/;
  const done = doneMarker.test(text);
  const reply = text.replace(doneMarker, "").trim();

  if (reply) {
    await supabase.from("strengths_narrative_messages").insert({
      assessment_id,
      role: "assistant",
      content: reply,
    });
  }

  return NextResponse.json({ done, reply });
}
