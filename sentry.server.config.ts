// Sentry init for the Node.js server runtime (App Router server
// components, route handlers, server actions). Loaded from
// src/instrumentation.ts.

import * as Sentry from "@sentry/nextjs";

// Redact anything that looks like a JWT before an event leaves the
// process. Supabase session tokens are `eyJ…` triple-dot strings; if
// one lands in a message, breadcrumb data, or extra it must never
// be stored server-side at Sentry.
//
// We only touch fields Sentry guarantees are strings/plain data —
// walking the whole event blindly overflows the stack on deep
// structures like stack-frame `vars`, which is what caused
// JAVASCRIPT-NEXTJS-2 the first time we deployed this scrubber.
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

  // 10% of transactions traced — free tier + Vercel invocation
  // volume gets loud fast at 1.0. Bump per-route via tracesSampler
  // if we ever need higher fidelity on a specific path.
  tracesSampleRate: 0.1,

  enableLogs: true,

  beforeSend(event) {
    return scrubEvent(event);
  },
});
