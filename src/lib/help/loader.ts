import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import type { Role } from "@/lib/types";

// Resolves an in-app help doc for a given URL pathname and caller
// role. Docs live in `docs/help/*.md` and use a naming convention:
//   /admin/companies      -> admin.companies.md
//   /admin/companies/[id] -> admin.companies._id.md (matches any id)
//   /dashboard            -> dashboard.md
//
// The loader tries the most specific filename first (with dynamic
// segments treated as _id) and falls back to progressively less
// specific paths so subpages without their own doc still show
// something useful from their parent surface.

export type HelpDoc = {
  slug: string;
  title: string;
  roles: Role[] | null; // null == all roles
  markdown: string;
};

const HELP_DIR = path.join(process.cwd(), "docs", "help");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;

// Deems a URL segment "dynamic" — i.e. we should replace it with
// _id when trying to match a doc. UUIDs and pure numbers cover
// nearly every dynamic id we mint; anything else is treated as a
// static segment.
function isDynamicSegment(segment: string): boolean {
  return UUID_RE.test(segment) || NUMERIC_RE.test(segment);
}

// Generate candidate slug filenames for a pathname, most specific
// first. E.g. /admin/companies/abc-uuid-1234-... produces:
//   admin.companies._id
//   admin.companies
//   admin
export function candidateSlugs(pathname: string): string[] {
  const parts = pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (parts.length === 0) return ["index"];

  // First attempt: replace every dynamic segment with _id.
  const normalized = parts.map((p) => (isDynamicSegment(p) ? "_id" : p));
  const candidates: string[] = [];
  for (let end = normalized.length; end > 0; end--) {
    candidates.push(normalized.slice(0, end).join("."));
  }
  return candidates;
}

// Minimal frontmatter parser — no dependency needed. Supports the
// small subset we use: `key: value` and `key: [a, b, c]` inside a
// leading `---` fenced block. Anything unrecognised is ignored.
function parseFrontmatter(source: string): {
  meta: Record<string, string | string[]>;
  body: string;
} {
  const meta: Record<string, string | string[]> = {};
  const fenceStart = source.indexOf("---");
  if (fenceStart !== 0) return { meta, body: source };
  const fenceEnd = source.indexOf("\n---", fenceStart + 3);
  if (fenceEnd < 0) return { meta, body: source };
  const raw = source.slice(fenceStart + 3, fenceEnd);
  const body = source.slice(fenceEnd + 4).replace(/^\n/, "");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      meta[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { meta, body };
}

function parseRoles(value: string | string[] | undefined): Role[] | null {
  if (!value) return null;
  const list = Array.isArray(value) ? value : [value];
  const roles = list.filter(
    (r): r is Role =>
      r === "system_admin" ||
      r === "company_admin" ||
      r === "team_member" ||
      r === "aims_guide"
  );
  return roles.length > 0 ? roles : null;
}

async function readDoc(slug: string): Promise<HelpDoc | null> {
  const file = path.join(HELP_DIR, `${slug}.md`);
  let source: string;
  try {
    source = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(source);
  const title = typeof meta.title === "string" ? meta.title : slug;
  const roles = parseRoles(meta.roles);
  return { slug, title, roles, markdown: body.trim() };
}

// Resolve the most specific help doc that (a) exists and (b) is
// visible to the caller's role. Returns null if nothing matches.
export async function loadHelpForRoute(
  pathname: string,
  role: Role
): Promise<HelpDoc | null> {
  for (const slug of candidateSlugs(pathname)) {
    const doc = await readDoc(slug);
    if (!doc) continue;
    if (doc.roles && !doc.roles.includes(role)) continue;
    return doc;
  }
  return null;
}
