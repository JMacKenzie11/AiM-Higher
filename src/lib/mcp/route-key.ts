import { createHash, createHmac } from "node:crypto";

// THE MCP ROUTE KEY (0275). How the database tells a request that came
// through /api/mcp (logged and rate limited) from the same assistant
// token sent straight to the database API (neither).
//
// Derived, not stored: an HMAC of a fixed label under the instance's
// service key, which the server already holds and the assistant never
// sees. So there is no new secret to provision or rotate; rotating the
// service key rotates this too, and `npm run mcp:route-key` writes the
// new hash. The database keeps only the SHA-256 (aims_private.
// mcp_route_key), so reading the database does not reveal the key.

export const ROUTE_KEY_HEADER = "x-aims-route-key";
const LABEL = "aims-mcp-route-v1";

export function routeKeyFor(serviceKey: string): string {
  if (!serviceKey) throw new Error("routeKeyFor: no service key for this instance");
  return createHmac("sha256", serviceKey).update(LABEL).digest("hex");
}

// What the database stores and compares against.
export function routeKeyHash(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}
