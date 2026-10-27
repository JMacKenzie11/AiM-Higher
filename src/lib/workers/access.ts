import "server-only";

import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { isPrimaryInstance } from "@/lib/instances/primary";

// Who and where. Workers are a prototype on AiMS HQ (Jason, 2026-10-27):
// a system admin, on the primary instance. Off it, every page is not
// found, as the Capacity Diagnostic's are.
//
// Courtesy, as requireRole is. 0303 is the boundary: each person's
// workers answer only them, and off the primary instance nobody.
export async function requireWorkers() {
  const session = await requireRole(["system_admin"]);
  if (!(await isPrimaryInstance())) notFound();
  return session;
}
