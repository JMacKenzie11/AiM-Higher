import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRUSTED_REDIRECTS, assistantLabel, isTrustedRedirect, returnsToThisComputer } from "./trusted-clients";

const sql = readFileSync(join(__dirname, "..", "..", "..", "supabase", "migrations", "0301_assistant_trusted_grok_bot.sql"), "utf8");
const fn = sql.slice(sql.indexOf("create or replace function public.mcp_redirect_trusted"), sql.indexOf("comment on function public.mcp_redirect_trusted"));

describe("the approved assistants list", () => {
  it("matches the database's copy, address for address", () => {
    const inSql = [...fn.matchAll(/'((?:https?|cursor):[^']+)'/g)].map((m) => m[1]);
    expect(inSql.sort()).toEqual([...TRUSTED_REDIRECTS].sort());
    expect(fn).toContain("^https://chatgpt\\.com/connector/oauth/[A-Za-z0-9_-]{1,128}$");
  });

  it("approves Claude's and ChatGPT's real callbacks", () => {
    expect(isTrustedRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isTrustedRedirect("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(isTrustedRedirect("https://chatgpt.com/connector/oauth/abc_123")).toBe(true);
  });

  it("approves Grok Bot's six, exactly", () => {
    for (const u of [
      "https://grok.com/connectors-oauth-exchange-code/",
      "https://www.cursor.com/bot/mcp/oauth/callback",
      "https://www.cursor.com/agents/mcp/oauth/callback",
      "cursor://anysphere.cursor-mcp/oauth/callback",
      "http://localhost:8787/callback",
      "http://127.0.0.1:8787/callback",
    ]) {
      expect(isTrustedRedirect(u)).toBe(true);
    }
  });

  it("says when the return is a program on this computer", () => {
    expect(returnsToThisComputer("http://localhost:8787/callback")).toBe(true);
    expect(returnsToThisComputer("http://127.0.0.1:8787/callback")).toBe(true);
    expect(returnsToThisComputer("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
    expect(returnsToThisComputer("https://grok.com/connectors-oauth-exchange-code/")).toBe(false);
    expect(returnsToThisComputer("https://claude.ai/api/mcp/auth_callback")).toBe(false);
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
      "http://localhost:8788/callback",
      "http://localhost:8787/other",
      "https://localhost:8787/callback",
      "cursor://anysphere.cursor-mcp/oauth/callback/x",
      "cursor://evil/oauth/callback",
      "https://grok.com/connectors-oauth-exchange-code",
      "https://cursor.com/bot/mcp/oauth/callback",
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
