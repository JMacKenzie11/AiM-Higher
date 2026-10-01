// Sentry init for the Edge runtime (middleware, edge route handlers).
// Loaded from src/instrumentation.ts. Kept in sync with
// sentry.server.config.ts: same data rules, same scrubber, same
// sample rate. See src/lib/observability/scrub-event.ts.

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

  tracesSampleRate: 0.1,

  enableLogs: true,

  sendDefaultPii: false,
  dataCollection: DATA_COLLECTION,

  integrations: [scrubPersonalDataIntegration()],

  beforeSend(event) {
    return scrubEvent(event);
  },
  beforeSendTransaction(event) {
    return scrubEvent(event);
  },
});
