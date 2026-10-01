import type { Role } from "@/lib/types";

// WHO SEES AIMEE'S PANEL (Jason, 2026-09-30).
//
// System admins always. Everyone else only once AIMEE_PANEL_FOR_EVERYONE
// is "true" in the deployment's environment, which is its own step, taken
// after the help rewrite and the first-reply check are live. Until then
// everyone else keeps what they had: the "?" help button, and Aimee's
// invitations and shared chats in the bell.
//
// Read on the server, per request, so turning it on or off is a change
// to the environment and a redeploy, never a code change.

export function panelForEveryone(): boolean {
  return process.env.AIMEE_PANEL_FOR_EVERYONE === "true";
}

export function seesAimeePanel(role: Role): boolean {
  return role === "system_admin" || panelForEveryone();
}
