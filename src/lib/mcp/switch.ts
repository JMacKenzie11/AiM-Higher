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

//   MCP_INSTANCES      optional: the instances (by subdomain, "@" for
//                      the apex, production) where MCP may run at all.
//                      Unset means every instance. Set, an instance not
//                      named answers 404 everywhere MCP_ENABLED is
//                      checked. One Vercel deployment serves every
//                      instance, so this is what keeps PromiseOne dark
//                      while production is switched on (2026-10-14).
//
// `subdomain` is the request's instance. Asked without one while
// MCP_INSTANCES is set, the answer is no: fail closed.
export function mcpEnabled(subdomain?: string): boolean {
  if (process.env.MCP_ENABLED !== "true") return false;
  const only = (process.env.MCP_INSTANCES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (only.length === 0) return true;
  return subdomain !== undefined && only.includes(subdomain);
}

export function mcpOpenTo(role: string | null | undefined): boolean {
  return role === "system_admin" || process.env.MCP_FOR_EVERYONE === "true";
}
