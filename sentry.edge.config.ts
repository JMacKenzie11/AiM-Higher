// Sentry init for the Edge runtime (middleware, edge route handlers).
// Loaded from src/instrumentation.ts. Kept in sync with
// sentry.server.config.ts — same scrubber, same sample rate.

import * as Sentry from "@sentry/nextjs";

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function redact(s: string | undefined): string | undefined {
  return s ? s.replace(JWT, "[JWT_REDACTED]") : s;
}

function scrubShallow(obj: Record<string, unknown> | undefined) {
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") obj[k] = redact(v);
  }
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  event.message = redact(event.message);
  for (const ex of event.exception?.values ?? []) {
    ex.value = redact(ex.value);
  }
  for (const bc of event.breadcrumbs ?? []) {
    bc.message = redact(bc.message);
    scrubShallow(bc.data);
  }
  scrubShallow(event.extra);
  scrubShallow(event.tags as Record<string, unknown> | undefined);
  return event;
}

Sentry.init({
  dsn: "https://cfe4404b707a11cbf34a5f659d927ad6@o4511878465978368.ingest.us.sentry.io/4511878475415552",

  tracesSampleRate: 0.1,

  enableLogs: true,

  beforeSend(event) {
    return scrubEvent(event);
  },
});
