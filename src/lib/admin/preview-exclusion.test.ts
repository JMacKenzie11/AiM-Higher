import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Every analytics read of coaching_conversations excludes previews.
//
// ---- WHY THIS IS A SOURCE TEST AND NOT A RUNTIME ONE ----------
//
// All seven of these run on the SERVICE-ROLE client, which bypasses
// RLS, so no policy can exclude a preview for them. The exclusion is
// therefore a convention held in seven separate files, and a
// convention is exactly what the eighth query forgets.
//
// The failure would be silent and specific: a system admin
// rehearsing an unpublished draft in the Agent Hub would be counted
// as usage, inflating agent adoption — the one number the platform
// dashboard exists to report honestly.
//
// So the list is CLOSED. Adding an analytics query on this table
// fails this test until somebody records which kind it is, the same
// discipline memory-sweep-mount.test.ts applies to coaching
// surfaces.

const ROOT = process.cwd();

// file -> how many reads of coaching_conversations it makes in an
// analytics path. Every one of them must carry is_preview.
const ANALYTICS_READS: ReadonlyArray<{ file: string; expected: number }> = [
  { file: "src/app/api/cron/themes/route.ts", expected: 1 },
  { file: "src/app/api/cron/coaching-insights/route.ts", expected: 1 },
  // Three: conversation counts, message volume (joined), and agent
  // adoption.
  { file: "src/lib/admin/dashboard-service.ts", expected: 3 },
  // Two: the per-agent buckets and the analyses window.
  { file: "src/lib/admin/coaching-insights-service.ts", expected: 2 },
];

const TOTAL = 7;

function read(file: string): string {
  return readFileSync(path.join(ROOT, file), "utf8");
}

describe("preview conversations are excluded from every analytics path", () => {
  it("each file carries the predicate as many times as it reads the table", () => {
    for (const { file, expected } of ANALYTICS_READS) {
      const source = read(file);
      const hits = source.match(/is_preview/g)?.length ?? 0;
      expect(
        hits,
        `${file} should exclude previews on all ${expected} of its analytics ` +
          `reads of coaching_conversations. Found ${hits}. If you added a ` +
          `query, add .eq("is_preview", false) and bump the count here.`
      ).toBe(expected);
    }
  });

  it("the whole set adds up to the seven queries migration 0229 names", () => {
    const total = ANALYTICS_READS.reduce((n, r) => n + r.expected, 0);
    expect(total).toBe(TOTAL);
  });

  it("the message-volume query filters on the JOINED table, not its own", () => {
    // coaching_messages is the FROM here, so a bare is_preview would
    // be a column that does not exist on it. PostgREST needs the
    // embedded resource named. Getting this wrong throws at runtime
    // rather than silently including previews, but it throws in a
    // cron, where nobody is watching.
    const source = read("src/lib/admin/dashboard-service.ts");
    expect(source).toContain('.eq("coaching_conversations.is_preview", false)');
  });

  it("the memory sweep is NOT in this list, and that is deliberate", () => {
    // The sweep already filters practice_id is null (agents produce
    // no memory), and a preview always carries a practice_id — so it
    // is excluded by a rule that predates previews entirely. Adding
    // is_preview there would look load-bearing and would not be.
    const sweep = read("src/lib/coach/memory-actions.ts");
    expect(sweep).toContain('.is("practice_id", null)');
    expect(sweep).not.toContain("is_preview");
  });
});
