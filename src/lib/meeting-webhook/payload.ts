import type { StoredRubric } from "@/lib/leadership/rubric/stored";

// The "meeting ready" webhook (2026-11-19): what it says, and whether
// it is configured. Pure, so the tests can reach it without
// server-only. The sending is in send.ts.

export const MEETING_READY_EVENT = "meeting.analysis_ready";

export type MeetingReadyConfig = {
  url: string;
  // A header the receiver checks, both set or both absent.
  header: { name: string; value: string } | null;
};

// Reads the three Vercel env vars. No URL means switched off. A header
// name without a key (or the reverse) is treated as no header rather
// than sending half of one.
export function webhookConfig(env: Record<string, string | undefined> = process.env): MeetingReadyConfig | null {
  const url = env.MEETING_READY_WEBHOOK_URL?.trim();
  if (!url) return null;
  const name = env.MEETING_READY_WEBHOOK_HEADER?.trim();
  const value = env.MEETING_READY_WEBHOOK_KEY?.trim();
  return { url, header: name && value ? { name, value } : null };
}

export type MeetingReadyPayload = {
  event: typeof MEETING_READY_EVENT;
  meeting_id: string;
  company_id: string;
  company_name: string;
  meeting_title: string | null;
  meeting_date: string;
  meeting_url: string;
  analyzed_at: string;
  // The facilitation rubric's score (2026-11-27), for the Grok Bot's
  // score video, handed back with the AI apps tool
  // set_meeting_score_video. Null when the meeting was not scored.
  score: MeetingReadyScore | null;
};

// What a score video needs and nothing more: the number, each part's
// level, and the wording the page shows. Never the quoted moments: they
// are the transcript's own words, and the transcript is for coaches and
// system admins only.
export type MeetingReadyScore = {
  out_of_ten: string;
  total: number;
  out_of: 50;
  try_next_week: { step: string; part: string } | null;
  parts: Array<{ name: string; level: number; went_well: string[]; even_better: string[] }>;
  set_video_with: "set_meeting_score_video";
};

export function scoreForWebhook(rubric: StoredRubric | null): MeetingReadyScore | null {
  if (!rubric) return null;
  let pick: StoredRubric["parts"][number] | null = null;
  for (const p of rubric.parts) {
    if (p.better.length > 0 && (!pick || p.level < pick.level)) pick = p;
  }
  return {
    out_of_ten: rubric.outOfTen,
    total: rubric.total,
    out_of: 50,
    try_next_week: pick
      ? { step: pick.better[0].text.replace(/\s*\([^)]*\)(?=\.?$)/, ""), part: pick.name }
      : null,
    parts: rubric.parts.map((p) => ({
      name: p.name,
      level: p.level,
      went_well: p.wins.map((w) => w.text),
      even_better: p.better.map((b) => b.text),
    })),
    set_video_with: "set_meeting_score_video",
  };
}

// Small on purpose: who and which meeting, and the score's wording
// (scoreForWebhook). The summary itself is read with the AI apps
// get_meeting tool, which checks the reader's access.
export function meetingReadyPayload(args: {
  meetingId: string;
  companyId: string;
  companyName: string;
  meetingTitle: string | null;
  meetingDateIso: string;
  origin: string;
  rubric?: StoredRubric | null;
  now?: Date;
}): MeetingReadyPayload {
  return {
    event: MEETING_READY_EVENT,
    meeting_id: args.meetingId,
    company_id: args.companyId,
    company_name: args.companyName,
    meeting_title: args.meetingTitle,
    meeting_date: args.meetingDateIso,
    meeting_url: `${args.origin}/leadership/meetings/${args.meetingId}`,
    analyzed_at: (args.now ?? new Date()).toISOString(),
    score: scoreForWebhook(args.rubric ?? null),
  };
}
