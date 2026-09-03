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

  // Session Replay is deliberately NOT listed here. Naming
  // replayIntegration() statically pulls the rrweb recorder into the
  // first chunk of EVERY route, for every visitor, authenticated or
  // not — the largest avoidable item in the initial JS payload. It is
  // attached after hydration instead; see below.
  //
  // Worth noting posthog-js already works this way: it resolves to
  // dist/module.js, not module.full.js, so its own recorder is
  // fetched on demand. Sentry was the outlier.
  integrations: [],

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

// ---- Session Replay, attached off the critical path ----------
//
// Loaded for EVERY session, not just the sampled 10%. That is
// deliberate: replaysOnErrorSampleRate is 1.0, so the recorder has to
// be present in a session that has not been sampled, otherwise an
// error there produces no replay. Sampling stays entirely Sentry's
// decision via the two rates in init() above; all this changes is
// WHEN the recorder arrives.
//
// The trade, stated plainly: the first moment of a session is not
// recorded, so an error in the first second or two may have a short
// or empty buffer. Everything after hydration behaves as before.
//
// lazyLoadIntegration fetches from Sentry's CDN. There is no CSP on
// this app today, so nothing blocks it; if one is ever added it needs
// to allow browser.sentry-cdn.com or replay silently stops working.
// The catch below keeps that failure contained — errors, traces and
// logs are unaffected by it.
if (typeof window !== "undefined") {
  const attachReplay = async () => {
    try {
      const replayIntegration = await Sentry.lazyLoadIntegration(
        "replayIntegration"
      );
      Sentry.addIntegration(replayIntegration());
    } catch {
      // CDN unreachable or blocked. Replay is a diagnostic nicety;
      // losing it must never take error reporting down with it.
    }
  };

  // Read it as a value rather than testing `"requestIdleCallback" in
  // window`: the DOM lib declares it unconditionally, so TypeScript
  // narrows the else branch to `never` and the Safari fallback fails
  // to compile.
  const idle = (
    window as Window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number }
      ) => number;
    }
  ).requestIdleCallback;

  if (typeof idle === "function") {
    // timeout so a permanently busy main thread still attaches it.
    idle(() => void attachReplay(), { timeout: 5000 });
  } else {
    // Safari has no requestIdleCallback.
    window.setTimeout(() => void attachReplay(), 2000);
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
