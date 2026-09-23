import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// INSTANCES ARE ISLANDS, AS A GATE RATHER THAN A CONVENTION.
//
// ---- the rule ------------------------------------------------
//
// While serving a request, code may only ever talk to the instance
// that request is for. No page, no server action, no route handler
// reaches into another instance's database.
//
// ---- why it needs a test and not a comment -------------------
//
// Nothing stops it. Every instance's deployment holds every other
// instance's service-role key, because that is how the cron fan-out
// reaches them: lookupInstance() resolves a subdomain to
// {PREFIX}_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY, and those live
// in the one deployment that serves the whole fleet.
//
// So instance isolation is not enforced by credentials. It is a
// discipline, and this file is the only thing that makes it a rule.
// A single `createSupabaseAdminClient(await lookupInstance(other))`
// in a page would read another tenant's data with no error, no
// warning, and nothing in review that had to notice.
//
// ---- how it is enforced --------------------------------------
//
// A closed allowlist of files that may cross instances. Everything
// else in src/ must resolve its client from the CURRENT instance.
// Adding a crossing file fails this test until somebody records
// which kind it is, the same discipline memory-sweep-mount.test.ts
// applies to coaching surfaces and preview-exclusion.test.ts applies
// to analytics reads.
//
// ---- the deferred push ---------------------------------------
//
// Agent distribution (phase 4b, deferred until a third instance
// exists) will be the second entry here: it writes outward from an
// explicit admin action, never while serving a client. It is named
// now so that whoever builds it finds this list rather than
// discovering the rule by breaking it. See docs/product-spec.md
// §14e.

const ROOT = path.join(process.cwd(), "src");

// The ONLY things that may resolve an instance other than the
// current one, each with the reason it is allowed.
const ALLOWED = new Map<string, string>([
  [
    "lib/instances/for-each.ts",
    "The cron fan-out. Runs from a schedule with no request and no " +
      "session, doing the same work on every instance in turn. It is " +
      "the reason the credentials exist.",
  ],
  [
    "lib/instances/registry.ts",
    "The registry itself: it reads the control plane and resolves a " +
      "subdomain to credentials. It hands them out; it does not use them.",
  ],
  // resolve.ts and context.ts were in this list until the third
  // assertion below rejected them: neither calls these functions at
  // all. resolve.ts maps a hostname to the CURRENT request's
  // instance and context.ts just holds it, so neither was ever
  // crossing. Listing them was dead permission, which is how the
  // next real crossing gets waved through.
]);

// Calling any of these with something other than the current
// instance is how a crossing happens.
const CROSSING_CALLS = [/\blookupInstance\s*\(/, /\blistActiveInstances\s*\(/];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // Tests may reference anything; they are not request-serving.
    if (/\.test\.tsx?$/.test(entry)) continue;
    acc.push(full);
  }
  return acc;
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

describe("instances are islands", () => {
  it("only the allowlisted files resolve another instance", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      const rel = relative(file);
      if (ALLOWED.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      if (CROSSING_CALLS.some((re) => re.test(source))) offenders.push(rel);
    }

    expect(
      offenders,
      "These files resolve an instance other than the current one. While " +
        "serving a request that reads another tenant's database. If one of " +
        "them is legitimate background work, add it to ALLOWED in this file " +
        "with the reason — do not delete the assertion."
    ).toEqual([]);
  });

  it("the allowlist names only files that exist", () => {
    // A stale entry is worse than none: it silently permits a path
    // that was moved or renamed.
    const missing = [...ALLOWED.keys()].filter((rel) => {
      try {
        statSync(path.join(ROOT, rel));
        return false;
      } catch {
        return true;
      }
    });
    expect(missing, "allowlisted files that no longer exist").toEqual([]);
  });

  it("every allowlisted file actually crosses, so the list stays honest", () => {
    // The mirror of the test above. An entry that no longer crosses
    // is dead permission, and dead permission is how the next
    // crossing gets waved through.
    const inert = [...ALLOWED.keys()].filter((rel) => {
      const source = readFileSync(path.join(ROOT, rel), "utf8");
      return !CROSSING_CALLS.some((re) => re.test(source));
    });
    expect(inert, "allowlisted files that no longer cross instances").toEqual(
      []
    );
  });

  it("is shown red against a planted crossing", () => {
    // E4: a check whose pass condition is "no offenders" must show
    // that an offender was findable. This plants one in memory and
    // asserts the same matcher catches it.
    const planted = "const other = await lookupInstance('someone-else');";
    expect(CROSSING_CALLS.some((re) => re.test(planted))).toBe(true);
    const innocent = "const cfg = await getCurrentInstanceConfig();";
    expect(CROSSING_CALLS.some((re) => re.test(innocent))).toBe(false);
  });
});
