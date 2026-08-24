"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";

// Product-analytics provider. Only mounted inside the authenticated
// app shell (src/app/(app)/layout.tsx) — the public marketing site
// is intentionally not tracked. `identified_only` means PostHog only
// creates person profiles for known users (no anonymous quota burn).
//
// Init runs once per browser tab (module-level `ready` flag). The
// identify effect refires whenever the user's identity or company
// context changes, so a scoped guide switching companies re-groups
// their events under the right company.

export type PostHogUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  company_id: string | null;
  company_name: string | null;
};

let ready = false;

export function PostHogProvider({
  user,
  children,
}: {
  user: PostHogUser | null;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (ready) return;
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    posthog.init(key, {
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      capture_pageview: "history_change",
      capture_pageleave: true,
      person_profiles: "identified_only",
    });
    // Environment tag so dev/preview traffic can be filtered out of
    // production feature-usage reports.
    posthog.register({ env: process.env.NODE_ENV });
    ready = true;
  }, []);

  useEffect(() => {
    if (!ready || !user) return;
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
  }, [
    user?.id,
    user?.email,
    user?.full_name,
    user?.role,
    user?.company_id,
    user?.company_name,
  ]);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
