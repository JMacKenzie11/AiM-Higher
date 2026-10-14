import { createHash, randomBytes } from "node:crypto";

// THE MCP ROUTE SECRET (0275). How the database tells a request that
// came through /api/mcp (logged and rate limited) from the same
// assistant token sent straight to the database API (neither).
//
// Its own random secret per instance, <PREFIX>_MCP_ROUTE_SECRET (Jason,
// 2026-10-14: not derived from the service key, which stays exactly as
// it is). The route sends it as x-aims-route-key; the database keeps
// only its SHA-256 (aims_private.mcp_route_key), so reading the database
// does not reveal it. `npm run mcp:route-key` generates it, writes it to
// Vercel and .env.provisioning, and writes the hash; --check compares.

export const ROUTE_KEY_HEADER = "x-aims-route-key";

// 32 random bytes as hex: 256 bits, header-safe.
export function generateRouteSecret(): string {
  return randomBytes(32).toString("hex");
}

// What the database stores and compares against.
export function routeKeyHash(secret: string): string {
  if (!secret) throw new Error("routeKeyHash: no route secret");
  return createHash("sha256").update(secret, "utf8").digest("hex");
}
