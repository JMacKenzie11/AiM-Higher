import "server-only";

import { PostHog } from "posthog-node";

// Server-side product analytics. Called from server actions after a
// mutation succeeds so we count *actual* completed work, not
// intent. Analytics must never break the request — every failure
// path is swallowed.
//
// Serverless caveat: Vercel functions can freeze the runtime the
// moment they return, so we flush explicitly per capture rather
// than relying on the SDK's background timer. The overhead is one
// network round-trip; happy to revisit if a hot path shows up in
// traces.

type Groups = Record<string, string>;

export async function track(
  distinctId: string,
  event: string,
  properties: Record<string, unknown> = {},
  groups: Groups = {}
): Promise<void> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  try {
    const posthog = new PostHog(key, {
      host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
    posthog.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        env: process.env.NODE_ENV,
      },
      groups,
    });
    await posthog.shutdown();
  } catch {
    // fire-and-forget — analytics never breaks user actions
  }
}
