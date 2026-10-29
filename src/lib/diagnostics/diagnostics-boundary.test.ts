import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// THE BOUNDARY, both ways (Capacity Diagnostic build spec, "What stays
// out of the rest of the platform"). The module reads and writes only
// its own tables, so nothing in it imports the platform's company work
// (commitments, the plan, measures, issues, companies), and nothing
// outside the module imports from it. A source scan, as
// scope-writers.test.ts is: the property is about which files import
// what.

const SRC = path.resolve(__dirname, "../..");
// The client portal (0307) is part of the module: a diagnostic client's
// dashboard, outside the (app) group so it has no sidebar.
const PORTAL_DIR = path.join(SRC, "app/portal");
const MODULE_DIRS = [path.join(SRC, "lib/diagnostics"), path.join(SRC, "app/(app)/diagnostics"), PORTAL_DIR];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "node_modules" || entry.startsWith(".") ? [] : walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function imports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);
}

const inModule = (f: string) => MODULE_DIRS.some((d) => f.startsWith(d + path.sep));
const all = walk(SRC);

describe("the Capacity Diagnostic's boundary", () => {
  it("imports nothing of the platform's company work", () => {
    const forbidden = /^@\/lib\/(commitments|plan|measures|issues|companies)(\/|$)/;
    const offenders = all
      .filter(inModule)
      .flatMap((f) => imports(f).filter((i) => forbidden.test(i)).map((i) => `${path.relative(SRC, f)} imports ${i}`));
    expect(offenders).toEqual([]);
  });

  it("is imported by nothing outside itself", () => {
    const offenders = all
      .filter((f) => !inModule(f))
      .flatMap((f) =>
        imports(f)
          .filter((i) => /^@\/lib\/diagnostics(\/|$)/.test(i) || /(^|\/)\(app\)\/diagnostics(\/|$)/.test(i))
          .map((i) => `${path.relative(SRC, f)} imports ${i}`)
      );
    expect(offenders).toEqual([]);
  });

  it("opens every page only for a system admin on the primary instance", () => {
    const pages = all.filter((f) => inModule(f) && !f.startsWith(PORTAL_DIR + path.sep) && path.basename(f) === "page.tsx");
    expect(pages.length).toBeGreaterThan(0);
    const offenders = pages.filter((f) => !/await requireDiagnostics\(\)/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("opens the portal only for a diagnostic client", () => {
    expect(readFileSync(path.join(PORTAL_DIR, "layout.tsx"), "utf8")).toMatch(/role !== "diagnostic_client"\) redirect\(/);
  });

  it("names no platform table", () => {
    const tables = /\.from\(\s*["'](companies|profiles|priorities|commitments|success_measures|issues|functions|foundation_items)["']/;
    // Client logins (0307) read a client person's own profile row (name,
    // role, status), in these two files and nowhere else in the module.
    const PROFILE_READERS = ["lib/diagnostics/member-actions.ts", "lib/diagnostics/service.ts"];
    const offenders = all.filter(inModule).filter((f) => {
      if (f.endsWith(".test.ts")) return false;
      const src = readFileSync(f, "utf8");
      const scrubbed = PROFILE_READERS.includes(path.relative(SRC, f)) ? src.replace(/\.from\(\s*["']profiles["']/g, "") : src;
      return tables.test(scrubbed);
    });
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
