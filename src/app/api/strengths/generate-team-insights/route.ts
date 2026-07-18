import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { anthropic, ANTHROPIC_MODEL } from "@/lib/strengths/anthropic";
import { VOICE_RULES } from "@/lib/strengths/voice-rules";
import { computeTeamSignals, type TeamMember } from "@/lib/strengths/team-signals";
import { SUB_STRENGTH_LABELS, type ResultsProfile } from "@/lib/strengths/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You write the Team Insights narrative for the AiMS Strengths Assessment.

You receive:
- A roster (people, positions, reporting lines)
- Each person's numeric sub-strength profile (competence and energy on a 1-5 scale, plus flags)
- Precomputed team signals: coverage per sub-strength, sole-holder flags, largest competence-minus-energy gaps, and orientation mix

Write a single team-level narrative of roughly 250 to 350 words.

Rules:
- Frame everything as configuration, never ranking or deficit. Low scores are configuration data about where energy is better spent, not weaknesses. Do not rank people against each other.
- Name specific people by first name and specific sub-strengths by their labels.
- Cover: team coverage strengths, coverage gaps, single points of failure (sole holders) as dependency risks, and capable-but-draining flags as configuration conversations worth having.
- End with two or three concrete suggestions, such as pairings for particular initiatives, or where the next hire or development focus should go.
- Never invent scores, names, or sub-strengths. Only use what appears in the input.
- No headings, no bullet lists. Two to four paragraphs, natural rhythm.

${VOICE_RULES}

Return ONLY a single JSON object of shape { "narrative": string }. No prose before or after. No code fences.`;

type ProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  reports_to: string | null;
};

export async function POST(request: Request) {
  const { company_id } = await request.json();
  if (!company_id) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("role, company_id")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const allowed =
    me.role === "system_admin" ||
    (me.role === "company_admin" && me.company_id === company_id);
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: assessments } = await supabase
    .from("strengths_assessments")
    .select("id, user_id, completed_at")
    .eq("company_id", company_id)
    .eq("status", "completed");

  if (!assessments || assessments.length === 0) {
    return NextResponse.json(
      { error: "no completed assessments" },
      { status: 400 },
    );
  }

  const sourceMax =
    assessments
      .map((a) => a.completed_at as string | null)
      .filter((t): t is string => !!t)
      .sort()
      .reverse()[0] ?? null;

  const { data: existing } = await supabase
    .from("strengths_team_insights")
    .select("id, source_max_completed_at")
    .eq("company_id", company_id)
    .maybeSingle();

  if (
    existing &&
    sourceMax &&
    existing.source_max_completed_at &&
    new Date(existing.source_max_completed_at).getTime() ===
      new Date(sourceMax).getTime()
  ) {
    return NextResponse.json({ ok: true, cached: true });
  }

  const userIds = assessments.map((a) => a.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, position, reports_to")
    .in("id", userIds);

  const { data: results } = await supabase
    .from("strengths_results")
    .select("assessment_id, profile")
    .in(
      "assessment_id",
      assessments.map((a) => a.id),
    );

  const resultsByAssessment = new Map(
    (results ?? []).map((r) => [
      r.assessment_id as string,
      r.profile as ResultsProfile,
    ]),
  );
  const profileById = new Map<string, ProfileRow>(
    (profiles ?? []).map((p) => [p.id as string, p as ProfileRow]),
  );

  const team: TeamMember[] = [];
  for (const a of assessments) {
    const p = profileById.get(a.user_id as string);
    const r = resultsByAssessment.get(a.id as string);
    if (p && r) {
      team.push({
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        position: p.position,
        reports_to: p.reports_to,
        profile: r,
      });
    }
  }

  if (team.length === 0) {
    return NextResponse.json({ error: "no results" }, { status: 400 });
  }

  const signals = computeTeamSignals(team);

  const rosterForModel = team.map((m) => {
    const manager = m.reports_to ? profileById.get(m.reports_to) : null;
    return {
      first_name: m.first_name,
      last_name: m.last_name,
      position: m.position,
      reports_to: manager
        ? `${manager.first_name} ${manager.last_name}`
        : null,
      orientation: m.profile.orientation.lean,
      sub_strengths: m.profile.sub_strengths.map((s) => ({
        sub_strength: SUB_STRENGTH_LABELS[s.sub_strength] ?? s.sub_strength,
        competence: s.competence,
        energy: s.energy,
        flag: s.flag,
      })),
    };
  });

  const nameById = (id: string) => {
    const p = profileById.get(id);
    return p ? p.first_name : "";
  };

  const signalsForModel = {
    coverage: signals.coverage.map((c) => ({
      sub_strength: SUB_STRENGTH_LABELS[c.sub_strength] ?? c.sub_strength,
      count: c.count,
      level: c.level,
      holders: c.holder_ids.map(nameById).filter(Boolean),
    })),
    sole_holders: signals.sole_holders.map((h) => ({
      sub_strength: SUB_STRENGTH_LABELS[h.sub_strength] ?? h.sub_strength,
      person: `${h.person.first_name} ${h.person.last_name}`,
      position: h.person.position,
    })),
    largest_energy_gaps: signals.energy_gaps.map((g) => ({
      sub_strength: SUB_STRENGTH_LABELS[g.sub_strength] ?? g.sub_strength,
      person: `${g.person.first_name} ${g.person.last_name}`,
      position: g.person.position,
      competence: g.competence,
      energy: g.energy,
      gap: g.gap,
    })),
    orientation_mix: signals.orientation_mix,
    roster_size: signals.roster_size,
  };

  const client = anthropic();
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          "Team data. Produce the JSON output as specified.\n\n" +
          JSON.stringify({ roster: rosterForModel, signals: signalsForModel }, null, 2),
      },
    ],
  });

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  let parsed: { narrative: string };
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return NextResponse.json(
      { error: "model returned invalid JSON" },
      { status: 502 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("strengths_team_insights")
    .upsert(
      {
        company_id,
        narrative: parsed.narrative,
        stats: signals,
        model: ANTHROPIC_MODEL,
        source_max_completed_at: sourceMax,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

function stripFences(t: string) {
  return t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}
