"use client";

import type { PostHog } from "posthog-js";

// POSTHOG, LOADED AFTER THE PAGE IS UP (2026-11-10 performance audit).
//
// posthog-js is about 83 kB compressed. Imported at the top of
// instrumentation-client.ts it was downloaded and run before anything
// on any route could respond, the marketing page and sign-in included.
// Nothing a person sees depends on it.
//
// So nothing imports posthog-js directly any more. Callers hand their
// work to withPostHog(), which runs it at once when the library is up
// and otherwise keeps it, in order, until it is. The library is
// fetched when the browser goes idle after the page has loaded (or
// after two seconds, whichever comes first), started with the same
// settings as before, and the kept work is replayed.
//
// WHAT THIS COSTS, said plainly: a page somebody leaves within the
// first second or two may never be counted, and an error thrown in
// that window is not captured by PostHog (Sentry, which is not
// deferred, still gets it). Events fired in that window are not lost:
// they wait and are sent with the time they are replayed.
//
// SIGNING OUT BEFORE IT HAS LOADED. reset() forgets who the browser
// was. If the library is not up there is nothing in memory to forget,
// but the previous page may have stored the identity, and the next
// person to sign in on this browser must not inherit it. So the reset
// is remembered across the navigation (sessionStorage) and done first
// thing the next time the library starts.

type Job = (posthog: PostHog) => void;

const RESET_PENDING = "aims-posthog-reset-pending";

let ready: PostHog | null = null;
let starting = false;
let queue: Job[] = [];

function config(): { key: string; host: string } | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  return key && host ? { key, host } : null;
}

async function start(): Promise<void> {
  if (ready || starting) return;
  const cfg = config();
  if (!cfg) return;
  starting = true;
  try {
    const { default: posthog } = await import("posthog-js");
    posthog.init(cfg.key, {
      api_host: cfg.host,
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
    try {
      if (window.sessionStorage.getItem(RESET_PENDING)) {
        window.sessionStorage.removeItem(RESET_PENDING);
        posthog.reset();
      }
    } catch {
      // No sessionStorage (private mode, blocked): nothing was remembered.
    }
    ready = posthog;
    const jobs = queue;
    queue = [];
    for (const job of jobs) {
      try {
        job(posthog);
      } catch {
        // Analytics must never break the page.
      }
    }
  } catch {
    // The download failed (offline, blocked). Try again on a later call.
    starting = false;
  }
}

// Called once from instrumentation-client.ts.
export function schedulePostHog(): void {
  if (typeof window === "undefined" || !config()) return;
  const go = () => void start();
  const whenIdle = () => {
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (ric) ric(go, { timeout: 2000 });
    else window.setTimeout(go, 1);
  };
  if (document.readyState === "complete") whenIdle();
  else window.addEventListener("load", whenIdle, { once: true });
}

// Run `job` with the library: now if it is up, otherwise when it is.
export function withPostHog(job: Job): void {
  if (typeof window === "undefined" || !config()) return;
  if (ready) {
    try {
      job(ready);
    } catch {
      // Analytics must never break the page.
    }
    return;
  }
  queue.push(job);
}

// Sign-out: forget who this browser was. See the note at the top.
export function resetPostHog(): void {
  if (typeof window === "undefined" || !config()) return;
  // Whatever was waiting belonged to the person signing out.
  queue = [];
  if (ready) {
    ready.reset();
    return;
  }
  try {
    window.sessionStorage.setItem(RESET_PENDING, "1");
  } catch {
    // Nothing to remember it in.
  }
}
