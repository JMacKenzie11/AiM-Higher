// WHO MAY CONNECT AN OUTSIDE ASSISTANT, and whether anyone may.
//
// Two environment switches, read per request on the server, the same
// pattern the Aimee panel shipped behind (git show
// b8f6907:src/lib/aimee/panel-audience.ts):
//
//   MCP_ENABLED        the global switch. Off unless "true": the MCP
//                      route, its metadata and the consent page all
//                      answer 404, so nothing is discoverable.
//   MCP_FOR_EVERYONE   widens it from system admins to everyone.
//                      Jason, 2026-10-13: system admins first, and only
//                      once the allow-list rules (0270) are proven.
//
// The checks are enforced where the work happens (the route, the
// consent page and its actions), not only in what a page shows.

export function mcpEnabled(): boolean {
  return process.env.MCP_ENABLED === "true";
}

export function mcpOpenTo(role: string | null | undefined): boolean {
  return role === "system_admin" || process.env.MCP_FOR_EVERYONE === "true";
}
