"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

// WHAT A DRAWER HAS OPEN, for Aimee's panel (Step 4).
//
// A record page tells the panel what is open through its URL. A drawer
// that opens a record without changing the URL (the function editor on
// /chart) tells it here instead: the record's page pattern and its id,
// nothing more. The panel sends those two with a message and the
// server loads the record under the person's own session
// (lib/aimee/page-context.ts), so what reaches Aimee is what the
// database lets this person read, never what the browser says.
//
// Held in a ref, not state: nothing renders from it, and a drawer
// opening should not re-render the layout.

export type OpenRecord = { pattern: string; id: string };

type Registry = {
  set: (record: OpenRecord | null) => void;
  get: () => OpenRecord | null;
};

const OpenRecordContext = createContext<Registry | null>(null);

export function OpenRecordProvider({ children }: { children: ReactNode }) {
  const current = useRef<OpenRecord | null>(null);
  const value = useMemo<Registry>(
    () => ({
      set: (record) => {
        current.current = record;
      },
      get: () => current.current,
    }),
    []
  );
  return <OpenRecordContext.Provider value={value}>{children}</OpenRecordContext.Provider>;
}

// Called by a drawer with the record it has open, or null when closed.
// Cleared when the drawer unmounts.
export function useOpenRecord(pattern: string, id: string | null) {
  const registry = useContext(OpenRecordContext);
  useEffect(() => {
    if (!registry) return;
    registry.set(id ? { pattern, id } : null);
    return () => {
      if (registry.get()?.id === id) registry.set(null);
    };
  }, [registry, pattern, id]);
}

// For the panel: read what is open at the moment a message is sent.
export function useReadOpenRecord(): () => OpenRecord | null {
  const registry = useContext(OpenRecordContext);
  return useCallback(() => registry?.get() ?? null, [registry]);
}
