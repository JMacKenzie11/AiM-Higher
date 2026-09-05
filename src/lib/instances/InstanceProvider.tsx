"use client";

import { createContext, useContext } from "react";
import type { PublicInstanceConfig } from "./current";

// Carries the current instance's Supabase URL and anon key to client
// components.
//
// Why a provider rather than page props: the two client components
// that build a browser Supabase client (the strengths assessment
// flow and its start button) both sit several levels below the
// authenticated layout, and threading two strings through their
// parent pages would put instance plumbing into components that have
// nothing else to do with it. The (app) layout already mounts
// PostHogProvider this way, so this is the pattern the codebase
// already has rather than a new one.
//
// Only the anon key travels here. It is public by design (it is in
// the client bundle today as NEXT_PUBLIC_SUPABASE_ANON_KEY, and RLS
// is what actually protects the data), while the service key never
// leaves the server. That is why the context type is
// PublicInstanceConfig and not InstanceConfig.

const InstanceContext = createContext<PublicInstanceConfig | null>(null);

export function InstanceProvider({
  config,
  children,
}: {
  config: PublicInstanceConfig;
  children: React.ReactNode;
}) {
  return (
    <InstanceContext.Provider value={config}>
      {children}
    </InstanceContext.Provider>
  );
}

export function useInstanceConfig(): PublicInstanceConfig {
  const config = useContext(InstanceContext);
  if (!config) {
    // Loud on purpose. The alternative is a browser client silently
    // built against undefined, which surfaces as an unexplained 401
    // somewhere far away from the missing provider.
    throw new Error(
      "useInstanceConfig must be used inside an InstanceProvider. " +
        "The authenticated layout mounts one; a client component " +
        "outside it needs its own.",
    );
  }
  return config;
}
