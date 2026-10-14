import { describe, expect, it } from "vitest";
import { parseInstanceHeader, serializeInstance } from "./request";

const base = {
  subdomain: "acme",
  displayName: "Acme",
  supabaseUrl: "https://acme.supabase.co",
  supabaseAnonKey: "anon",
  supabaseServiceKey: "service",
  status: "active" as const,
};

describe("the MCP route secret travels with the instance", () => {
  it("survives the header round trip from middleware", () => {
    expect(parseInstanceHeader(serializeInstance({ ...base, mcpRouteSecret: "s3cret" }))?.mcpRouteSecret).toBe("s3cret");
  });

  it("is optional: without it the instance still resolves", () => {
    const parsed = parseInstanceHeader(serializeInstance(base));
    expect(parsed?.subdomain).toBe("acme");
    expect(parsed?.mcpRouteSecret).toBeUndefined();
  });
});
