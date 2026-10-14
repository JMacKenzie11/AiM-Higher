import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRUSTED_REDIRECTS, assistantLabel, isTrustedRedirect } from "./trusted-clients";

const sql = readFileSync(join(__dirname, "..", "..", "..", "supabase", "migrations", "0280_assistant_trusted_clients.sql"), "utf8");
const fn = sql.slice(sql.indexOf("create or replace function public.mcp_redirect_trusted"), sql.indexOf("comment on function public.mcp_redirect_trusted"));

describe("the approved assistants list", () => {
  it("matches the database's copy, address for address", () => {
    const inSql = [...fn.matchAll(/'(https:[^']+)'/g)].map((m) => m[1]);
    expect(inSql.sort()).toEqual([...TRUSTED_REDIRECTS].sort());
    expect(fn).toContain("^https://chatgpt\\.com/connector/oauth/[A-Za-z0-9_-]{1,128}$");
  });

  it("approves Claude's and ChatGPT's real callbacks", () => {
    expect(isTrustedRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isTrustedRedirect("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(isTrustedRedirect("https://chatgpt.com/connector/oauth/abc_123")).toBe(true);
  });

  it("refuses lookalikes, other paths, plain http and localhost", () => {
    for (const u of [
      "https://claude.ai.evil.example/api/mcp/auth_callback",
      "https://evil.example/claude.ai/api/mcp/auth_callback",
      "https://claude.ai/other",
      "http://claude.ai/api/mcp/auth_callback",
      "https://chatgpt.com/connector/oauth/../x",
      "http://127.0.0.1:53682/callback",
      "http://localhost:3000/callback",
    ]) {
      expect(isTrustedRedirect(u)).toBe(false);
    }
  });

  it("names the assistant by the domain it returns to", () => {
    expect(assistantLabel("Claude", "https://claude.ai/api/mcp/auth_callback")).toBe("Claude (claude.ai)");
    expect(assistantLabel("Claude", "https://evil.example/cb")).toBe("Claude (evil.example)");
    expect(assistantLabel("", "https://chatgpt.com/connector/oauth/x")).toBe("An AI app (chatgpt.com)");
  });
});
