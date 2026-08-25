// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (!posthogKey || !posthogHost) {
  if (process.env.NODE_ENV === "development") {
    const missingVariable = posthogKey
      ? "NEXT_PUBLIC_POSTHOG_HOST"
      : "NEXT_PUBLIC_POSTHOG_KEY";
    throw new Error(
      `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`
    );
  }
} else {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    // Kept pointing at the real PostHog dashboard even when api_host
    // is the reverse-proxy subdomain (e.g. e.aims-hq.com), so that
    // any UI links the SDK renders (session replay, feature-flag
    // links, etc.) open the actual PostHog site instead of the proxy.
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    capture_pageview: "history_change",
    capture_pageleave: true,
    capture_exceptions: true,
    person_profiles: "identified_only",
  });
  posthog.register({ env: process.env.NODE_ENV });
}

Sentry.init({
  dsn: "https://cfe4404b707a11cbf34a5f659d927ad6@o4511878465978368.ingest.us.sentry.io/4511878475415552",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // 10% traces — same reasoning as sentry.server.config.ts (Vercel
  // + free tier gets loud fast). Bump if we need higher fidelity.
  tracesSampleRate: 0.1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
