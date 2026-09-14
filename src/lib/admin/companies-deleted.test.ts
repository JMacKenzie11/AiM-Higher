import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// SOURCE GUARD: a service-role read of `companies` must exclude
// soft-deleted rows itself.
//
// Migration 0148 hides them with a RESTRICTIVE RLS policy, chosen
// explicitly so that "we don't have to sweep dozens of query sites
// app-wide — the row simply disappears everywhere". That reasoning is
// sound for the caller's client and silently false for the service
// role, which bypasses RLS by design. The result was deleted
// companies listed on the platform dashboard, including in Needs
// attention, where a tenant nobody can reach was reported as having
// no coach conversations on record.
//
// A behavioural test cannot catch the next one: the offending file is
// whichever new service-role reader someone adds next, and it will
// look exactly as correct as the four in dashboard-service.ts did.
// So this reads the source.
//
// Scope: files that obtain a service-role client AND read companies.
// A file using the caller's client is deliberately NOT flagged — RLS
// is doing the work there, and demanding a redundant filter would
// teach people the policy cannot be trusted.

const ROOT = "src";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

// The two ways a module ends up holding a service-role client: it
// builds one, or it is handed one by the cron runner.
const SERVICE_ROLE = /createSupabaseAdminClient|run:\s*async\s*\(\{\s*admin/;

describe("service-role reads of companies exclude soft-deleted rows", () => {
  it("every service-role `from(\"companies\")` filters deleted_at", () => {
    const offenders: string[] = [];

    for (const file of walk(ROOT)) {
      const raw = readFileSync(file, "utf8");
      if (!SERVICE_ROLE.test(raw)) continue;
      // Comments are stripped before measuring, or the window below
      // is spent on prose. Caught in the first run of this guard:
      // the cron's filter IS present and a comment explaining why
      // pushed it out of range, which would have taught the next
      // person that the fix is to write less about it.
      const src = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      // Each read, with the chain that follows it. 400 chars of
      // CODE covers the longest builder in the codebase by a wide
      // margin; a filter further away than that is not legibly
      // attached to the query anyway.
      const reads = [...src.matchAll(/\.from\("companies"\)/g)];
      for (const match of reads) {
        const chain = src.slice(match.index, match.index + 400);
        // An insert or update is not a read.
        if (/\.(insert|update|upsert|delete)\(/.test(chain.slice(0, 120))) {
          continue;
        }
        // A lookup pinned to one id is answering "this company",
        // where the caller already holds the id and a deleted row
        // yields a null the caller must handle regardless.
        if (/\.eq\("id",/.test(chain)) continue;
        if (!/\.is\("deleted_at", null\)/.test(chain)) {
          offenders.push(
            `${file}: ${chain.split("\n").slice(0, 3).join(" ").trim()}`
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
