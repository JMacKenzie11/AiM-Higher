import "server-only";

import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { isPrimaryInstance } from "@/lib/instances/primary";

// Who and where. The Capacity Diagnostic is HQ's alone (Jason,
// 2026-10-22): a system admin, on the primary instance. Off it, every
// page is not found, as if the module were not there. The flag is
// instance_settings.is_primary (0231), set by `npm run instance:primary`
// and by nothing in the app, so no page carries a switch for it.
//
// Courtesy, as requireRole is. 0295 is the boundary: off the primary
// instance the tables answer nobody, so an action that reaches them
// anyway saves nothing.
export async function requireDiagnostics() {
  const session = await requireRole(["system_admin"]);
  if (!(await isPrimaryInstance())) notFound();
  return session;
}
