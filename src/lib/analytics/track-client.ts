"use client";

import posthog from "posthog-js";

// Client-side product analytics. src/instrumentation-client.ts initializes
// the singleton before the app mounts; callers just import this helper and fire.

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
