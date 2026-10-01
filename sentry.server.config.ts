// Sentry init for the Node.js server runtime (App Router server
// components, route handlers, server actions). Loaded from
// src/instrumentation.ts.
//
// What leaves the process is decided in
// src/lib/observability/scrub-event.ts, shared with the edge and
// browser configs: no IP addresses, cookies, headers, query strings,
// or request and response bodies.

import * as Sentry from "@sentry/nextjs";
import { sentryEnabledOnServer } from "./src/lib/observability/sentry-enabled";
import {
  DATA_COLLECTION,
  scrubEvent,
  scrubPersonalDataIntegration,
} from "./src/lib/observability/scrub-event";

Sentry.init({
  dsn: "https://cfe4404b707a11cbf34a5f659d927ad6@o4511878465978368.ingest.us.sentry.io/4511878475415552",

  // Vercel deployments only. Local dev, local builds and e2e runs use
  // the dev database, which holds copies of client data; none of it
  // may reach Sentry. See docs/deployment.md, "Error monitoring".
  enabled: sentryEnabledOnServer({
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  }),
  // "production" or "preview", so the two never mix in Sentry.
  environment: process.env.VERCEL_ENV,

  // 10% of transactions traced — free tier + Vercel invocation
  // volume gets loud fast at 1.0. Bump per-route via tracesSampler
  // if we ever need higher fidelity on a specific path.
  tracesSampleRate: 0.1,

  enableLogs: true,

  sendDefaultPii: false,
  dataCollection: DATA_COLLECTION,

  integrations: [
    // Replaces the Http integration @sentry/nextjs installs by default
    // (same name, so this one wins) with one change: it no longer
    // buffers incoming request bodies. That buffering (up to 10 KB,
    // "medium") is on by default and does not consult
    // dataCollection.httpBodies; the body then lands in
    // event.request.data. Server action POSTs and /api/coach
    // conversation text are exactly those bodies.
    Sentry.httpIntegration({
      disableIncomingRequestSpans: true,
      maxIncomingRequestBodySize: "none",
    }),
    scrubPersonalDataIntegration(),
  ],

  beforeSend(event) {
    return scrubEvent(event);
  },
  beforeSendTransaction(event) {
    return scrubEvent(event);
  },
});
