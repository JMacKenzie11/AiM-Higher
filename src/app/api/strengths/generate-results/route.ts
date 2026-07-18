import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { anthropic, ANTHROPIC_MODEL } from "@/lib/strengths/anthropic";
import { VOICE_RULES } from "@/lib/strengths/voice-rules";
import { scoreResponses } from "@/lib/strengths/scoring";
import { tenurePhrase } from "@/lib/strengths/tenure";
import {
  DIMENSION_LABELS,
  SUB_STRENGTH_LABELS,
  type Item,
} from "@/lib/strengths/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are writing the results output for the AiMS Strengths Assessment.

You receive: (1) the person's numeric scores for sixteen sub-strengths, each on a competence and energy axis; (2) an orientation lean from direct to facilitative; (3) a short narrative transcript, which may be absent or marked "[skipped]"; and (4) their name, position, and tenure in the position.

You must produce a single JSON object with two top-level keys: "profile" and "summary".

The "profile" key must exactly match this shape (fill in the values):
{
  "dimensions": [
    { "dimension": "thinking" | "influence" | "execution" | "relating", "competence_avg": number, "energy_avg": number }
  ],
  "sub_strengths": [
    {
      "sub_strength": string,
      "dimension": "thinking" | "influence" | "execution" | "relating",
      "competence": number,
      "energy": number,
      "flag": "signature" | "capable_but_draining" | "hidden_pull" | "lower_priority",
      "narrative_evidence": string | null
    }
  ],
  "orientation": { "lean": "direct" | "balanced" | "facilitative", "score": number, "by_dimension": object },
  "top_strengths": string[],
  "divergences": [ { "sub_strength": string, "note": string } ],
  "narrative_coded": string[]
}

Rules for scoring and interpretation:
- Dimension averages already provided are correct. Copy them into "dimensions" verbatim.
- Sub-strength flags are already computed. Copy them into "sub_strengths" verbatim.
- Never collapse competence and energy into a single number.
- "top_strengths" lists the sub_strength ids that are flagged "signature", ordered by combined competence+energy score descending. If there are no signatures, include the top three by combined score.
- For each sub_strength, if the narrative evidences it, put a short direct quote (or a paraphrase in the person's terms) in "narrative_evidence". Otherwise set it to null.
- "narrative_coded" is the list of sub_strength ids the story evidenced.
- "divergences" is where the story contradicts a high self-rating or reveals energy the score-based responses missed. Prefer the story where they disagree, since specific past behavior is harder to inflate.
- If the narrative was skipped or absent, "narrative_coded" is [] and "divergences" is [], and every "narrative_evidence" is null.
- Each divergence "note" is user-facing text that will render inside the "Worth exploring" section on their results page. Write it as a warm coach's observation, one to three sentences, in the second person addressed to the reader as "you". Do not name a numeric score, do not use measurement or assessment jargon (never write "Likert", "Likert scale", "scale", "rating", "score", "self-rating", "self-report", "instrument", "psychometric", or anything of that shape), and do not describe the mechanics of the assessment. Say what the story shows and what the self-view seems to be, in the person's own terms.

Naming rules (applies to every user-facing text field: "summary" and every "note" inside "divergences"):
- Always refer to sub-strengths and dimensions by their human-readable labels, taken from the "labels" map in the input. Examples: write "Building trust" (not building_trust), "Problem solving" (not problem_solving), "Follow-through" (not follow_through), "Developing others" (not developing_others), "Relating" (not relating).
- Never emit a raw snake_case identifier in prose. If you catch yourself writing an underscore in a strength or dimension name, rewrite the sentence using the label.
- The snake_case ids in the "scoring" payload are for internal round-tripping only. Copy them verbatim into JSON id fields ("sub_strength", "dimension", "narrative_coded", "top_strengths"). Never surface them to the reader.

Rules for the "summary" text:
- Roughly 300 to 450 words. Addressed to the person as "you".
- Reads like a thoughtful coach wrote it. Warm, plain, direct. Use contractions.
- Frame everything as configuration and energy, never deficit. Low scores are described as "where your energy is better spent elsewhere," not weaknesses.
- Explicitly name any capable-but-draining sub-strengths, kindly. That's the most useful signal in the profile.
- Name any story-and-scores divergences as something worth exploring, not an inconsistency.
- No lists of every sub-strength. Pick the ones that matter and develop the thought.
- No headings, no markdown. Two to four paragraphs, natural rhythm.
- Never name numeric scores or use measurement jargon. Do not write "Likert", "Likert scale", "scale", "rating", "self-rating", "self-report", "score of X", "the assessment measured", "instrument", "psychometric", or anything that describes the mechanics of the assessment. Talk about what the person's energy and story show, in their own terms.

${VOICE_RULES}

Return ONLY a single JSON object. No prose before or after. No code fences.`;

export async function POST(request: Request) {
  const { assessment_id } = await request.json();
  if (!assessment_id) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: assessment } = await supabase
    .from("strengths_assessments")
    .select("id, user_id, company_id, status")
    .eq("id", assessment_id)
    .single();
  if (!assessment) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Only owner or admin (via RLS on read) can trigger generation.
  if (assessment.user_id !== user.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  // Skip if already generated
  const { data: existing } = await supabase
    .from("strengths_results")
    .select("id")
    .eq("assessment_id", assessment_id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, already: true });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, position, position_start_date")
    .eq("id", user.id)
    .single();

  const { data: items } = await supabase.from("strengths_items").select("*");
  const { data: responses } = await supabase
    .from("strengths_responses")
    .select("item_id, value")
    .eq("assessment_id", assessment_id);
  const { data: narrative } = await supabase
    .from("strengths_narrative_messages")
    .select("role, content")
    .eq("assessment_id", assessment_id)
    .order("created_at", { ascending: true });

  const scored = scoreResponses(
    (items ?? []) as Item[],
    responses ?? [],
  );

  const userPayload = {
    person: {
      first_name: profile?.first_name,
      position: profile?.position,
      tenure_in_position: tenurePhrase(profile?.position_start_date),
    },
    scoring: scored,
    // Human-readable labels for every id in the scoring payload. Use these in
    // any user-facing prose. The snake_case ids like "building_trust" appear
    // in the scoring data only so the code can round-trip them; they should
    // never appear in written output.
    labels: {
      sub_strengths: SUB_STRENGTH_LABELS,
      dimensions: DIMENSION_LABELS,
    },
    narrative_transcript:
      narrative
        ?.map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n") ?? "",
  };

  const client = anthropic();
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 3000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          "Here is the person's data. Produce the JSON output as specified.\n\n" +
          JSON.stringify(userPayload, null, 2),
      },
    ],
  });

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  let parsed: { profile: unknown; summary: string };
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return NextResponse.json(
      { error: "model returned invalid JSON" },
      { status: 502 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("strengths_results").insert({
    assessment_id,
    profile: parsed.profile,
    summary: parsed.summary,
    model: ANTHROPIC_MODEL,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

function stripFences(t: string) {
  return t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}
