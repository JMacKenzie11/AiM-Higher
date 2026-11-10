"use client";

import { withPostHog } from "./posthog-lazy";
import { useEffect } from "react";

// PostHog starts after the page is up (src/lib/analytics/posthog-lazy.ts,
// scheduled from src/instrumentation-client.ts). This component keeps the
// signed-in user and company in step with it.

export type PostHogUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  company_id: string | null;
  company_name: string | null;
};

export function PostHogProvider({
  user,
  children,
}: {
  user: PostHogUser | null;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!user) return;
    // Runs now if PostHog is up, otherwise as soon as it is: it loads
    // after the page does (posthog-lazy.ts).
    withPostHog((posthog) => {
      posthog.identify(user.id, {
        email: user.email,
        name: user.full_name,
        role: user.role,
        company_id: user.company_id,
        company_name: user.company_name,
      });
      if (user.company_id) {
        posthog.group("company", user.company_id, {
          name: user.company_name ?? user.company_id,
        });
      }
    });
  }, [
    user?.id,
    user?.email,
    user?.full_name,
    user?.role,
    user?.company_id,
    user?.company_name,
  ]);

  // No React context: nothing in the app reads PostHog through one
  // (no usePostHog, no feature-flag hooks), and providing it meant
  // importing the whole library with every page.
  return <>{children}</>;
}
