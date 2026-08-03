#!/usr/bin/env tsx
/**
 * Fails when a `src/app/(app)/**\/page.tsx` route has no covering
 * help doc in `docs/help/`.
 *
 * "Covering" means any of the following filenames exists:
 *   - the exact slug for the route (dynamic segments as `_id`), or
 *   - any prefix of it (so `plan.md` covers `plan.priority._id.md` too).
 *
 * Usage:
 *   pnpm run check:help           # CI mode: fail on missing
 *   pnpm run check:help --write   # dev mode: scaffold skeletons for
 *                                 # every missing doc and exit 0
 *
 * The scaffold writes a minimal frontmatter + TODO body so the
 * author still has to fill in real content, but they don't have to
 * remember the naming convention or the frontmatter shape.
 *
 * Exit codes:
 *   0 — every route is covered (or was, after --write scaffolded)
 *   1 — one or more routes are missing help docs (no --write)
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

function skeletonFor(route: string, slug: string): string {
  // Fallback title from the last non-underscore segment. E.g.
  //   plan.priority._id -> "priority"
  // The author will almost always rename this, but it beats leaving
  // it blank.
  const guessTitle = slug
    .split(".")
    .filter((p) => p !== "_id")
    .pop()
    ?.replace(/-/g, " ") ?? slug;
  const cased =
    guessTitle.charAt(0).toUpperCase() + guessTitle.slice(1);
  return `---
title: ${cased}
---

# ${cased}

<!-- TODO: replace this scaffold with real help copy.
     Route: ${route}
     See docs/help/README.md for the conventions. Aim for:
       - one sentence saying what this page is for
       - 2–3 "Common things people do here" bullets
       - any gotchas worth flagging
-->
`;
}

async function main() {
  const shouldWrite = process.argv.includes("--write");

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

  if (shouldWrite) {
    console.log(
      `Scaffolding ${missing.length} missing help doc${missing.length === 1 ? "" : "s"}…`
    );
    for (const { route, expected } of missing) {
      // Use the most specific candidate (index 0) as the target
      // filename. If the author wanted the umbrella doc instead,
      // they can delete the scaffold and let the fallback resolver
      // pick up the parent.
      const slug = expected[0];
      const target = path.join(HELP_ROOT, `${slug}.md`);
      await fs.writeFile(target, skeletonFor(route, slug), { flag: "wx" });
      console.log(`  created docs/help/${slug}.md   (${route})`);
    }
    console.log(
      "\nDone. Edit each scaffolded file, then re-run check:help to confirm coverage."
    );
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
    "\nTo scaffold skeletons automatically:  pnpm run check:help --write" +
      "\nSee docs/help/README.md for the frontmatter format and conventions."
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
