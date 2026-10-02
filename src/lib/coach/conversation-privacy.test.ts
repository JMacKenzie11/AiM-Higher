import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// CHECK 3 OF THE CONVERSATION PRIVACY CHECKS
// (docs/investigations/open-data.md §7; checks 1, 2 and 4 are in the
// RLS harness: "aimee conversations · ..." and "debrief invitations").
//
// An Aimee conversation is its owner's alone, and the read rules hold
// that for every role. The service role skips the rules, so code that
// reads a conversation table with it is a way around them. This lists
// every such read and fails on a new one, so a new reason has to be
// written down here, beside the others, before it ships.

const TABLES = ["coaching_messages", "coaching_conversations", "coach_memories", "coaching_conversation_shares"];

// Each with the reason it may. None reads memory.
const ALLOWED: Record<string, string> = {
  "src/app/api/cron/coaching-insights/route.ts":
    "the nightly insights job: reads conversations to write anonymous summaries (aimee/anonymise.ts)",
  "src/app/api/cron/themes/route.ts":
    "the nightly themes job: reads titles and first messages to write anonymous themes",
  "src/lib/admin/coaching-insights-service.ts":
    "the insights card: counts conversations per company, within the limits in insights-privacy.ts",
  "src/lib/admin/dashboard-service.ts": "the admin dashboard: counts per company, never text",
  "src/app/api/role-descriptions/export.docx/route.ts":
    "finds the conversation's company, then checks the caller's own access before anything else",
  "src/lib/chart/apply-proposal-action.ts":
    "finds the conversation's company, then checks the caller's own access before anything else",
  "src/lib/role-descriptions/save-action.ts":
    "finds the conversation's company, then checks the caller's own access before anything else",
};

// The variables a file binds to the service-role client, and whether
// any of them reads a conversation table.
function serviceRoleConversationReads(source: string): string[] {
  const clients = [...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*await\s+createSupabaseAdminClient\b/g)].map((m) => m[1]);
  const found = new Set<string>();
  for (const name of clients) {
    const re = new RegExp(`\\b${name}\\s*\\.from\\(\\s*"(${TABLES.join("|")})"`, "g");
    for (const m of source.matchAll(re)) found.add(m[1]);
  }
  return [...found].sort();
}

describe("service-role reads of Aimee conversations", () => {
  it("finds one when it is there, and not when the client is the person's own", () => {
    expect(
      serviceRoleConversationReads(`const admin = await createSupabaseAdminClient(cfg);
        const { data } = await admin
          .from("coaching_messages").select("content");`)
    ).toEqual(["coaching_messages"]);
    expect(
      serviceRoleConversationReads(`const db = await createSupabaseServerClient(cfg);
        await db.from("coaching_messages").select("content");`)
    ).toEqual([]);
  });

  it("happen only in the named places, and none reads memory", () => {
    const files = execFileSync("git", ["grep", "-l", "createSupabaseAdminClient", "--", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f && !/\.test\.tsx?$/.test(f));
    const reading = files.filter((f) => serviceRoleConversationReads(readFileSync(f, "utf8")).length > 0);
    expect(reading.sort()).toEqual(Object.keys(ALLOWED).sort());
    for (const f of reading) {
      expect(serviceRoleConversationReads(readFileSync(f, "utf8")), f).not.toContain("coach_memories");
    }
  });
});
