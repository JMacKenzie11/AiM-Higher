"use client";

import posthog from "posthog-js";

// Client-side product analytics. The PostHogProvider inside the
// (app) layout initializes the singleton on mount — callers just
// import this helper and fire. When analytics is disabled (no key)
// or the singleton hasn't initialized yet, the capture is a no-op.

export function trackClient(
  event: string,
  properties?: Record<string, unknown>
): void {
  try {
    posthog.capture(event, properties);
  } catch {
    // never let a broken analytics call break the interaction
  }
}
