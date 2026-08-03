#!/usr/bin/env tsx
/**
 * Fails when a `src/app/(app)/**\/page.tsx` route has no covering
 * help doc in `docs/help/`.
 *
 * "Covering" means any of the following filenames exists:
 *   - the exact slug for the route (dynamic segments as `_id`), or
 *   - any prefix of it (so `plan.md` covers `plan.priority._id.md` too).
 *
 * The whole point is to keep the help widget honest as new pages
 * ship. Wire this into CI (a `pnpm run check:help` step) so a PR
 * that adds a page.tsx without a paired doc doesn't merge silently.
 *
 * Exit codes:
 *   0 — every route is covered
 *   1 — one or more routes are missing help docs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const APP_ROOT = path.join(REPO_ROOT, "src", "app", "(app)");
const HELP_ROOT = path.join(REPO_ROOT, "docs", "help");

async function collectPageRoutes(dir: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const routes: string[] = [];
  let hasPage = false;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Route groups like (app) don't contribute a URL segment.
      const nextPrefix = entry.name.startsWith("(") && entry.name.endsWith(")")
        ? prefix
        : `${prefix}/${entry.name}`;
      const nested = await collectPageRoutes(
        path.join(dir, entry.name),
        nextPrefix
      );
      routes.push(...nested);
    } else if (entry.isFile() && entry.name === "page.tsx") {
      hasPage = true;
    }
  }
  if (hasPage) routes.push(prefix === "" ? "/" : prefix);
  return routes;
}

function routeToSlugCandidates(route: string): string[] {
  const parts = route
    .split("/")
    .filter(Boolean)
    .map((p) => (p.startsWith("[") && p.endsWith("]") ? "_id" : p));
  if (parts.length === 0) return ["index"];
  const candidates: string[] = [];
  for (let end = parts.length; end > 0; end--) {
    candidates.push(parts.slice(0, end).join("."));
  }
  return candidates;
}

async function existingHelpSlugs(): Promise<Set<string>> {
  const entries = await fs.readdir(HELP_ROOT, { withFileTypes: true });
  const slugs = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    if (entry.name === "README.md") continue;
    slugs.add(entry.name.replace(/\.md$/, ""));
  }
  return slugs;
}

async function main() {
  const [routes, slugs] = await Promise.all([
    collectPageRoutes(APP_ROOT),
    existingHelpSlugs(),
  ]);

  const missing: Array<{ route: string; expected: string[] }> = [];
  for (const route of routes.sort()) {
    const candidates = routeToSlugCandidates(route);
    const covered = candidates.some((c) => slugs.has(c));
    if (!covered) missing.push({ route, expected: candidates });
  }

  if (missing.length === 0) {
    console.log(`OK — all ${routes.length} routes have help coverage.`);
    process.exit(0);
  }

  console.error(
    `Missing help docs for ${missing.length} route${missing.length === 1 ? "" : "s"}:`
  );
  for (const { route, expected } of missing) {
    console.error(`  ${route}`);
    console.error(
      `    add one of: ${expected.map((s) => `docs/help/${s}.md`).join(", ")}`
    );
  }
  console.error(
    "\nSee docs/help/README.md for the frontmatter format and conventions."
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
