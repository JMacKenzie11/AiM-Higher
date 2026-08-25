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

// ---- Role-scoped section filter --------------------------------
//
// Help docs can gate parts of the same file to specific roles:
//
//   ::: role team_member
//   Content only team members see.
//   :::
//
//   ::: role company_admin,aims_guide,system_admin
//   Content only admins and guides see.
//   :::
//
// Anything outside a `::: role` block is shared with every role.
// Filtering happens server-side before the markdown ships to the
// widget — other roles' content is never in the response body.
//
// Fail-open on malformed blocks (an unclosed opener leaves its
// content intact and logs a warning) — a broken doc still shows
// something useful instead of blanking out mid-page.

const ROLE_BLOCK_OPEN = /^:::\s+role\s+(.+?)\s*$/;
const ROLE_BLOCK_CLOSE = /^:::\s*$/;

export function filterRoleSections(markdown: string, role: Role): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inBlock = false;
  let blockKeeps = false;
  let blockOpener = "";

  for (const line of lines) {
    if (!inBlock) {
      const match = line.match(ROLE_BLOCK_OPEN);
      if (match) {
        const allowed = match[1]
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean);
        blockKeeps = allowed.includes(role);
        inBlock = true;
        blockOpener = line;
        continue;
      }
      out.push(line);
      continue;
    }
    if (ROLE_BLOCK_CLOSE.test(line)) {
      inBlock = false;
      blockKeeps = false;
      blockOpener = "";
      continue;
    }
    if (blockKeeps) out.push(line);
  }

  if (inBlock) {
    // Unclosed opener — put the opener line back and let the rest
    // of the doc render as-is. Better than dropping content silently.
    console.warn(
      `Help doc has unclosed ::: role block: "${blockOpener}". Rendering full content.`
    );
    return markdown;
  }

  // Collapse runs of 3+ blank lines that stripped blocks leave
  // behind, so the rendered output doesn't have gaping holes.
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

// Resolve the most specific help doc that (a) exists and (b) is
// visible to the caller's role. Applies section-level role filters
// before returning so the response contains only what this role
// should see.
export async function loadHelpForRoute(
  pathname: string,
  role: Role
): Promise<HelpDoc | null> {
  for (const slug of candidateSlugs(pathname)) {
    const doc = await readDoc(slug);
    if (!doc) continue;
    if (doc.roles && !doc.roles.includes(role)) continue;
    return { ...doc, markdown: filterRoleSections(doc.markdown, role) };
  }
  return null;
}
