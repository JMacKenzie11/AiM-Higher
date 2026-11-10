"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";

// Initialization runs once in src/instrumentation-client.ts. This component
// keeps authenticated user and company context synchronized with that client.

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
    if (!posthog.__loaded || !user) return;
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
