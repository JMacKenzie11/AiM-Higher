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
};

// Small on purpose: who and which meeting. The summary itself is read
// with the AI apps get_meeting tool, which checks the reader's access.
export function meetingReadyPayload(args: {
  meetingId: string;
  companyId: string;
  companyName: string;
  meetingTitle: string | null;
  meetingDateIso: string;
  origin: string;
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
  };
}
