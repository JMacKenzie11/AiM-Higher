import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Who is allowed to move a caller into a company.
//
// THE RULE: only a server action, reached by a button somebody
// pressed. Never a request.
//
// It has been broken twice. First by middleware, which wrote the
// scope cookie on `GET /admin/companies/[id]` — so a Link prefetch
// scrolling into view could move an operator into a company nobody
// chose. That write was removed and the rule written down. Then by
// /api/coach/align-scope, a route handler that rewrote the cookie so
// a chat would render against its own tenant: same shape, narrower
// blast radius, and it persisted the change for eight hours, so
// reading one conversation silently moved where Dashboard took you.
//
// Both were removed. This is what makes the third one fail in CI
// rather than in production: a source scan, because the property is
// about which FILES contain a call, and no runtime assertion can see
// that.

const SRC = path.resolve(__dirname, "../..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(SRC);

// Crude but sufficient: block comments then line comments. This is
// only ever asked about a path literal, so the usual hazards of
// regex-stripping comments (a `//` inside a URL string, a `/*` inside
// a regex) cannot change the answer here.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function writesScopeCookie(file: string): boolean {
  const src = readFileSync(file, "utf8");
  // The definition itself lives in scope.ts; everything else that
  // names it is a caller.
  if (file.endsWith(path.join("lib", "admin", "scope.ts"))) return false;
  return src.includes("setScopedCompanyCookie");
}

const writers = files.filter(writesScopeCookie).map((f) => path.relative(SRC, f));

describe("who may write the scope cookie", () => {
  it("is exactly the two server actions that exist to do it", () => {
    // scope-actions.ts is the scope-in control. companies/actions.ts
    // scopes the creator into a company they just made, which is the
    // same act with the company named a moment earlier.
    expect(writers.sort()).toEqual([
      "lib/admin/scope-actions.ts",
      "lib/companies/actions.ts",
    ]);
  });

  it("is never a route handler", () => {
    // A route handler answers a REQUEST. A request must not change
    // who the caller is acting as, because a browser can make one
    // without a person deciding to: a prefetch, a scanner, a link
    // preview in a chat app.
    const routeWriters = writers.filter((f) => /(^|\/)route\.tsx?$/.test(f));
    expect(routeWriters).toEqual([]);
  });

  it("is never middleware", () => {
    const middlewareWriters = writers.filter((f) => f.startsWith("middleware."));
    expect(middlewareWriters).toEqual([]);
  });

  it("is never a page", () => {
    // A page render is a request too. Next.js forbids cookie writes
    // from a server component, which is a guard rail rather than a
    // rule — this states the rule.
    const pageWriters = writers.filter((f) => /(^|\/)page\.tsx?$/.test(f));
    expect(pageWriters).toEqual([]);
  });

  it("finds the writers at all, so a clean pass means something", () => {
    // The canary. A scan that matches nothing cannot tell a correct
    // codebase from a broken matcher.
    expect(writers.length).toBeGreaterThan(0);
  });
});

describe("the align-scope route is gone", () => {
  it("has no file", () => {
    const found = files.filter((f) => f.includes("align-scope"));
    expect(found).toEqual([]);
  });

  it("is called by nothing", () => {
    // Comments are stripped first, deliberately. Both chat pages
    // still NAME the route, in the note explaining why they no
    // longer bounce through it — that history is the most useful
    // thing in those files and a test that forbade it would get the
    // comment deleted rather than the rule kept.
    const referrers = files
      .filter((f) => stripComments(readFileSync(f, "utf8")).includes("align-scope"))
      .map((f) => path.relative(SRC, f));
    expect(referrers).toEqual([]);
  });
});
