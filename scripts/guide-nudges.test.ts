import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/instances/registry", () => ({ lookupInstance: vi.fn() }));

import { NUDGE_COLUMNS, changedAt, parseArgs, totalsByCompany, type NudgeRow } from "./guide-nudges";

const SOURCE = readFileSync(join(process.cwd(), "scripts/guide-nudges.ts"), "utf8");

// THE WALL. The headline is the only Guide text a system admin may see;
// the debrief after it is the champion's private conversation. This
// command must never name the tables that hold it, never join to them,
// never count them, and never select the nudge's link to one.
describe("guide:nudges never reaches the champion's conversation", () => {
  it("never names the conversation or message tables", () => {
    expect(SOURCE).not.toMatch(/coaching_conversations/);
    expect(SOURCE).not.toMatch(/coaching_messages/);
  });

  it("never selects the nudge's link to a conversation", () => {
    expect(SOURCE).not.toMatch(/conversation_id/);
    expect(NUDGE_COLUMNS).not.toMatch(/conversation/);
  });

  it("reads only the tables it needs", () => {
    const tables = [...SOURCE.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    expect([...new Set(tables)].sort()).toEqual(["companies", "guide_nudges", "meetings", "profiles"]);
  });

  it("never uses the service key or writes", () => {
    expect(SOURCE).not.toMatch(/SERVICE_KEY|supabaseServiceKey/);
    expect(SOURCE).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });
});

describe("parseArgs", () => {
  it("defaults to 30 days, no company, production", () => {
    const a = parseArgs([]);
    expect(a.company).toBeNull();
    expect(a.instance).toBe("@");
    const days = (Date.now() - Date.parse(`${a.since}T00:00:00Z`)) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31.1);
  });

  it("reads the flags and refuses a bad date", () => {
    expect(parseArgs(["--", "--company", "Benson Seafood", "--since", "2026-09-01", "--instance", "dev"])).toEqual({
      company: "Benson Seafood",
      since: "2026-09-01",
      instance: "dev",
    });
    expect(() => parseArgs(["--since", "last week"])).toThrow(/2026-09-01/);
  });
});

const row = (p: Partial<NudgeRow>): NudgeRow => ({
  id: "n", company_id: "c1", meeting_id: "m", headline: "h", state: "pending",
  raised_at: "2026-09-20T10:00:00Z", opened_at: null, dismissed_at: null, ...p,
});

describe("changedAt", () => {
  it("says when a state changed, and says so when it was not recorded", () => {
    expect(changedAt(row({ state: "opened", opened_at: "2026-09-21T08:30:00Z" }))).toBe("2026-09-21 08:30");
    expect(changedAt(row({ state: "dismissed", dismissed_at: "2026-09-22T09:00:00Z" }))).toBe("2026-09-22 09:00");
    expect(changedAt(row({ state: "superseded" }))).toBe("not recorded");
    expect(changedAt(row({ state: "pending" }))).toBe("");
  });
});

describe("totalsByCompany", () => {
  it("counts each state per company, and nothing else", () => {
    const t = totalsByCompany([
      row({ state: "opened" }), row({ state: "superseded" }), row({ state: "pending" }),
      row({ company_id: "c2", state: "dismissed" }),
    ]);
    expect(t.get("c1")).toEqual({ raised: 3, pending: 1, opened: 1, dismissed: 0, superseded: 1 });
    expect(t.get("c2")).toEqual({ raised: 1, pending: 0, opened: 0, dismissed: 1, superseded: 0 });
  });
});
