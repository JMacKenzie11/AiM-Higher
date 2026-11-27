import "server-only";

import { APP_URL } from "@/lib/supabase/env";
import { instanceOrigin } from "@/lib/instances/instance-origin";
import { meetingReadyPayload, webhookConfig } from "./payload";
import type { StoredRubric } from "@/lib/leadership/rubric/stored";

// Posts "meeting ready" to an outside URL (Jason, 2026-11-19: a Cursor
// automation) once a TEAM meeting's analysis is stored. Coaching calls
// never send it; the caller checks the kind.
//
// Configured by three Vercel env vars, Production only:
//   MEETING_READY_WEBHOOK_URL     where to post; unset means off
//   MEETING_READY_WEBHOOK_HEADER  the header name the receiver checks
//   MEETING_READY_WEBHOOK_KEY     that header's value
// The key lives only in Vercel, never in the repo.
//
// PRODUCTION ONLY, and the primary instance (aims-hq.com) only. The
// dev clone is a copy of production, so a meeting analysed on a laptop
// or a preview would fire the automation for a real company. One
// deployment serves every instance, and another instance's meetings
// are not ours to announce.
//
// Best effort: one try, ten seconds, never throws. A receiver that is
// down cannot fail a meeting summary that has already been saved.
export type WebhookResult = { sent: true; status: number } | { skipped: string };

export async function sendMeetingReadyWebhook(args: {
  meetingId: string;
  companyId: string;
  companyName: string;
  meetingTitle: string | null;
  meetingDateIso: string;
  subdomain: string;
  rubric?: StoredRubric | null;
}): Promise<WebhookResult> {
  const config = webhookConfig();
  if (!config) return { skipped: "MEETING_READY_WEBHOOK_URL is not set" };
  if (args.subdomain !== "@") return { skipped: `instance ${args.subdomain} is not the primary` };
  const payload = meetingReadyPayload({
    ...args,
    origin: instanceOrigin(args.subdomain, APP_URL()),
  });
  if (process.env.VERCEL_ENV !== "production") {
    console.log(`[meeting-webhook] meeting ${args.meetingId}: not production, would have posted`);
    return { skipped: "not production" };
  }
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (config.header) headers[config.header.name] = config.header.value;
    const res = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { skipped: `receiver answered ${res.status}` };
    return { sent: true, status: res.status };
  } catch (err) {
    return { skipped: err instanceof Error ? err.message : String(err) };
  }
}
