import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { todayInTimezone } from "@/lib/dates";
import type { Commitment, Priority } from "@/lib/types";

// Once-a-day AI "Week in review" for the dashboard.
//
// Caching model: one row per (company_id, brief_date). First admin
// through the door on a given day writes the row; the rest read it.
// A day rolls over in the COMPANY's timezone so the brief doesn't
// spuriously invalidate at UTC midnight.
//
// Model: reuses ANTHROPIC_COACH_MODEL so ops can pin one model
// across coaching + brief. Falls back to claude-sonnet-4-6 if unset.

export type DashboardBrief = {
  content: string;
  generatedAt: string; // ISO
  brief_date: string; // YYYY-MM-DD (company tz)
};

const SUMMARY_SYSTEM = `You're a smart, straight-talking colleague giving a busy operator a warm read on how the last week went. The AiMS philosophy is that follow-through builds momentum, and momentum builds trust — so you lead with what's working and where people showed up, then note where support would help.

Rules:
- One paragraph, 3-5 sentences. Nothing else.
- Sound like a human, not a report. Short sentences. Contractions welcome.
- Positive framing throughout — lead with wins and traction. When something's slipping, describe it as "where support would help" or "worth checking in on," not as failure. Never call anyone out for missing.
- Name specific people whose follow-through moved things, and specific priorities where progress happened.
- No corporate jargon: no "leverage," "demonstrates," "highlights," "notably," "furthermore," "moving forward," "actionable insights," or "kudos."
- No preamble ("here's a quick take on..."), no headings, no bullet lists, no closing wrap-up ("all in all...").
- Use real numbers where they add weight, but skip decimals when the sentence stiffens up.
- Don't repeat "the team" three times. Vary the subject.
- Don't quote missed reasons verbatim; if a pattern is present, note it gently as something to talk about.`;

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 400;

export async function getOrGenerateDashboardBrief(
  companyId: string,
  currentAdminId: string
): Promise<DashboardBrief | null> {
  const supabase = await createSupabaseServerClient();

  const { data: company } = await supabase
    .from("companies")
    .select("id, name, timezone")
    .eq("id", companyId)
    .maybeSingle<{ id: string; name: string; timezone: string }>();
  if (!company) return null;

  const tz = company.timezone ?? "America/Anchorage";
  const { iso: today } = todayInTimezone(tz);

  const { data: cached } = await supabase
    .from("dashboard_ai_briefs")
    .select("content, generated_at, brief_date")
    .eq("company_id", companyId)
    .eq("brief_date", today)
    .maybeSingle<{
      content: string;
      generated_at: string;
      brief_date: string;
    }>();
  if (cached) {
    return {
      content: cached.content,
      generatedAt: cached.generated_at,
      brief_date: cached.brief_date,
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const snapshot = await buildWeeklySnapshot(companyId, company.name, today);
  const model = process.env.ANTHROPIC_COACH_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });

  let content: string;
  try {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: SUMMARY_SYSTEM,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: snapshot }],
    });
    content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!content) return null;
  } catch {
    return null;
  }

  const insert = await supabase
    .from("dashboard_ai_briefs")
    .insert({
      company_id: companyId,
      brief_date: today,
      content,
      generated_by: currentAdminId,
    })
    .select("content, generated_at, brief_date")
    .maybeSingle<{
      content: string;
      generated_at: string;
      brief_date: string;
    }>();

  // Race with another admin's insert on the same day: our unique index
  // rejects one of the two. Re-read the winning row so both viewers
  // see the same brief.
  if (!insert.data) {
    const { data: winner } = await supabase
      .from("dashboard_ai_briefs")
      .select("content, generated_at, brief_date")
      .eq("company_id", companyId)
      .eq("brief_date", today)
      .maybeSingle<{
        content: string;
        generated_at: string;
        brief_date: string;
      }>();
    if (!winner) return null;
    return {
      content: winner.content,
      generatedAt: winner.generated_at,
      brief_date: winner.brief_date,
    };
  }

  return {
    content: insert.data.content,
    generatedAt: insert.data.generated_at,
    brief_date: insert.data.brief_date,
  };
}

// ---- Snapshot ----------------------------------------------------

async function buildWeeklySnapshot(
  companyId: string,
  companyName: string,
  today: string
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const openQuarter = await getCurrentQuarter(companyId);

  const weekStart = addDays(today, -6);

  const [recentRes, priorityRes, quarterRes] = await Promise.all([
    supabase
      .from("commitments")
      .select("owner_id, status, description, missed_reason, week_ending, due_date, priority_id")
      .eq("company_id", companyId)
      .gte("week_ending", weekStart)
      .lte("week_ending", today),
    supabase
      .from("priorities")
      .select("title, status, owner_id, archived")
      .eq("company_id", companyId)
      .eq("archived", false),
    openQuarter
      ? supabase
          .from("commitments")
          .select("status")
          .eq("company_id", companyId)
          .gte("week_ending", openQuarter.start_date)
          .lte("week_ending", openQuarter.end_date)
      : Promise.resolve({ data: [] as Array<{ status: string }> }),
  ]);
  const recentCommitments = recentRes.data;
  const priorities = priorityRes.data;
  const quarterKeep = quarterRes.data;

  const rows = (recentCommitments ?? []) as Array<
    Pick<
      Commitment,
      "owner_id" | "status" | "description" | "missed_reason" | "week_ending" | "due_date" | "priority_id"
    >
  >;

  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id)));
  const priorityIds = Array.from(
    new Set(
      rows
        .map((r) => r.priority_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const [{ data: profiles }, { data: priorityRows }] = await Promise.all([
    ownerIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", ownerIds)
      : Promise.resolve({ data: [] }),
    priorityIds.length > 0
      ? supabase.from("priorities").select("id, title").in("id", priorityIds)
      : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map(
    ((profiles ?? []) as Array<{ id: string; full_name: string }>).map((p) => [
      p.id,
      p.full_name,
    ])
  );
  const priorityTitleById = new Map(
    ((priorityRows ?? []) as Array<{ id: string; title: string }>).map((p) => [
      p.id,
      p.title,
    ])
  );

  const kept = rows.filter((r) => r.status === "kept").length;
  const closedLate = rows.filter((r) => r.status === "missed").length;
  const stillOpen = rows.filter((r) => r.status === "open").length;

  const missedThisWeek = rows.filter((r) => r.status === "missed");

  const priorityBucket = new Map<string, number>();
  for (const p of (priorities ?? []) as Array<Pick<Priority, "status">>) {
    priorityBucket.set(p.status, (priorityBucket.get(p.status) ?? 0) + 1);
  }

  const quarterStatuses = ((quarterKeep ?? []) as Array<{ status: string }>).map(
    (r) => r.status
  );
  const quarterKept = quarterStatuses.filter((s) => s === "kept").length;
  const quarterMissed = quarterStatuses.filter((s) => s === "missed").length;
  const quarterRate =
    quarterKept + quarterMissed === 0
      ? null
      : Math.round((quarterKept / (quarterKept + quarterMissed)) * 100);

  const lines: string[] = [];
  lines.push(`Company: ${companyName}`);
  lines.push(`Today: ${today}`);
  if (openQuarter) {
    lines.push(
      `Quarter ${openQuarter.label} — follow-through: ${
        quarterRate === null ? "—" : `${quarterRate}%`
      } (kept ${quarterKept}, closed late ${quarterMissed}).`
    );
  }
  lines.push("");
  lines.push(
    `Last 7 days — kept ${kept}, closed late ${closedLate}, still open ${stillOpen}.`
  );

  if (missedThisWeek.length > 0) {
    lines.push("");
    lines.push("Closed-late (missed) commitments this week, with the operator's stated reason:");
    for (const m of missedThisWeek.slice(0, 20)) {
      const who = nameById.get(m.owner_id) ?? "Unknown";
      const link = m.priority_id
        ? priorityTitleById.get(m.priority_id) ?? "(unlinked)"
        : "(operational)";
      const reason = m.missed_reason?.trim() || "(no reason)";
      lines.push(
        `- ${who} · ${m.description.trim()} · priority: ${link} · reason: "${reason}"`
      );
    }
  }

  const priorityBuckets: Array<[string, number]> = Array.from(
    priorityBucket.entries()
  );
  if (priorityBuckets.length > 0) {
    lines.push("");
    lines.push("Priority statuses (open-quarter, non-archived):");
    for (const [status, count] of priorityBuckets) {
      lines.push(`- ${status}: ${count}`);
    }
  }

  return lines.join("\n");
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
