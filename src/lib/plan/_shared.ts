import "server-only";

import type { CascadeStatus } from "@/lib/types";

// Shared types + parsing used by every plan action file. Kept off the
// "use server" boundary because Next.js requires "use server" files to
// export ONLY async functions — types and pure helpers live here.

export type PlanResult<T> =
  | { ok: true; item: T }
  | { ok: false; message: string };

export const CASCADE_STATUSES: readonly CascadeStatus[] = [
  "not_started",
  "on_track",
  "behind",
  "complete",
  "ongoing",
];

export function parseStatus(raw: string): CascadeStatus | null {
  return CASCADE_STATUSES.includes(raw as CascadeStatus)
    ? (raw as CascadeStatus)
    : null;
}
