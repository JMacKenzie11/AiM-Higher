import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PAGES, helpSlugsFor, linkablePagesFor } from "./registry";

// The page list stays complete (Jason, 2026-09-28: "build the page list,
// with CI checking it stays complete"). The routes are read from the
// filesystem the same way check:help reads them, so a new page.tsx
// without an entry fails here, and an entry whose page was removed
// fails too.

const APP = join(process.cwd(), "src", "app", "(app)");

function pagePatterns(dir: string, prefix = ""): Array<{ pattern: string; file: string }> {
  const out: Array<{ pattern: string; file: string }> = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      // Route groups, "(name)", add nothing to the URL.
      const seg = /^\(.*\)$/.test(name) ? "" : `/${name}`;
      out.push(...pagePatterns(full, prefix + seg));
    } else if (name === "page.tsx") {
      out.push({ pattern: prefix || "/", file: full });
    }
  }
  return out;
}

const onDisk = pagePatterns(APP);

describe("the page list", () => {
  it("has an entry for every page in the app", () => {
    const listed = new Set(PAGES.map((p) => p.pattern));
    expect(onDisk.map((p) => p.pattern).filter((p) => !listed.has(p))).toEqual([]);
  });

  it("names no page that does not exist", () => {
    const real = new Set(onDisk.map((p) => p.pattern));
    expect(PAGES.map((p) => p.pattern).filter((p) => !real.has(p))).toEqual([]);
  });

  it("lists each page once", () => {
    const seen = PAGES.map((p) => p.pattern);
    expect(seen.filter((p, i) => seen.indexOf(p) !== i)).toEqual([]);
  });

  it("gives a page the same roles as its own requireRole, where it has one", () => {
    const mismatches: string[] = [];
    for (const { pattern, file } of onDisk) {
      const m = /requireRole\(\[([^\]]*)\]\)/.exec(readFileSync(file, "utf8"));
      if (!m) continue;
      const guarded = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
      const entry = PAGES.find((p) => p.pattern === pattern);
      const listed = entry && entry.roles !== "all" ? [...entry.roles].sort() : ["(all)"];
      if (JSON.stringify(listed) !== JSON.stringify(guarded)) {
        mismatches.push(`${pattern}: page ${guarded.join(",")}, list ${listed.join(",")}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("only offers links to pages without a record id in them", () => {
    expect(PAGES.filter((p) => p.link && p.pattern.includes("[")).map((p) => p.pattern)).toEqual([]);
  });

  it("has a help file, its own or a parent's, for every page Aimee may link to", () => {
    const helpDir = join(process.cwd(), "docs", "help");
    const docs = new Set(readdirSync(helpDir).map((f) => f.replace(/\.md$/, "")));
    expect(PAGES.filter((p) => p.link && !helpSlugsFor(p.pattern).some((s) => docs.has(s))).map((p) => p.pattern)).toEqual([]);
    // A page borrowing a parent's help needs its own title.
    expect(
      PAGES.filter((p) => p.link && !docs.has(helpSlugsFor(p.pattern)[0]) && !p.title).map((p) => p.pattern)
    ).toEqual([]);
  });
});

describe("linkablePagesFor", () => {
  it("never offers a team member an admin page", () => {
    const pages = linkablePagesFor("team_member", ["execution", "classroom", "strengths"]).map((p) => p.pattern);
    expect(pages.filter((p) => p.startsWith("/admin") || p === "/hq" || p === "/portfolio")).toEqual([]);
    expect(pages).toContain("/plan");
  });

  it("does not offer pages behind a feature the company has not got", () => {
    const pages = linkablePagesFor("company_admin", ["execution"]).map((p) => p.pattern);
    expect(pages).not.toContain("/classroom");
    expect(pages).not.toContain("/strengths/teams");
  });
});

describe("pathMatchesPattern", () => {
  it("matches a page, a record page, and ignores query and hash", async () => {
    const { pathMatchesPattern } = await import("./registry");
    expect(pathMatchesPattern("/plan", ["/plan"])).toBe(true);
    expect(pathMatchesPattern("/plan?quarter=1#top", ["/plan"])).toBe(true);
    expect(pathMatchesPattern("/leadership/meetings/0bcab5ff", ["/leadership/meetings/[id]"])).toBe(true);
    expect(pathMatchesPattern("/leadership/meetings/a/b", ["/leadership/meetings/[id]"])).toBe(false);
    expect(pathMatchesPattern("/admin/agents", ["/plan", "/leadership/meetings/[id]"])).toBe(false);
  });

  it("gives a team member no admin page to open", async () => {
    const { openablePatternsFor, pathMatchesPattern } = await import("./registry");
    const mine = openablePatternsFor("team_member", ["execution"]);
    expect(pathMatchesPattern("/admin/agents", mine)).toBe(false);
    expect(pathMatchesPattern("/hq", mine)).toBe(false);
    expect(pathMatchesPattern("/leadership/meetings/abc", mine)).toBe(true);
  });
});

describe("linkDecision: the link check in Aimee's replies", () => {
  it("draws no link to an admin page for a team member", async () => {
    const { linkDecision, openablePatternsFor } = await import("./registry");
    const mine = openablePatternsFor("team_member", ["execution"]);
    expect(linkDecision("/admin/agents", mine)).toBe("text");
    expect(linkDecision("/hq", mine)).toBe("text");
    expect(linkDecision("/plan", mine)).toBe("in-app");
    expect(linkDecision("/leadership/meetings/abc", mine)).toBe("in-app");
  });

  it("leaves outside links alone, and every link when no list was given", async () => {
    const { linkDecision } = await import("./registry");
    expect(linkDecision("https://example.com", ["/plan"])).toBe("outside");
    expect(linkDecision("//evil.example", ["/plan"])).toBe("outside");
    expect(linkDecision("/admin/agents", undefined)).toBe("in-app");
  });
});
