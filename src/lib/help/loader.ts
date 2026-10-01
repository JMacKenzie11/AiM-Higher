import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { ROLES, type Role } from "@/lib/types";
import { seesAimeePanel } from "@/lib/aimee/panel-audience";

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

// A doc's `roles:` list, checked against every role there is.
//
// FAIL CLOSED. This used to keep only four roles and drop the rest, so
// `portfolio_admin` vanished from every list: portfolio.md read as
// system-admin-only and a portfolio admin on /portfolio got no help.
// Worse, a list whose every name was dropped came out EMPTY, and empty
// means "everyone": a doc marked `roles: [portfolio_admin]` would have
// shown to all roles. An unknown name now fails the doc loudly, and
// helpDocProblems (tested over every file) catches it before it ships.
export function parseRoles(value: string | string[] | undefined, slug = "?"): Role[] | null {
  if (!value) return null;
  const list = (Array.isArray(value) ? value : [value]).map((r) => r.trim()).filter(Boolean);
  if (list.length === 0) return null;
  const unknown = list.filter((r) => !(ROLES as readonly string[]).includes(r));
  if (unknown.length > 0) {
    throw new Error(`help doc ${slug}: unknown role(s) in roles: ${unknown.join(", ")}`);
  }
  return list as Role[];
}

// Every help doc the role may see, with the role's sections only: the
// same rules loadHelpForRoute applies to one page, applied to all of
// them. What Aimee's help search and page index read (help/search.ts),
// so she can never quote help the "?" would not show this person.
export async function loadAllHelpFor(role: Role): Promise<HelpDoc[]> {
  const files = (await fs.readdir(HELP_DIR)).filter((f) => f.endsWith(".md") && f !== "README.md");
  const docs: HelpDoc[] = [];
  for (const file of files.sort()) {
    const doc = await readDoc(file.replace(/\.md$/, ""));
    if (!doc) continue;
    if (doc.roles && !doc.roles.includes(role)) continue;
    docs.push({ ...doc, markdown: filterRoleSections(doc.markdown, role) });
  }
  return docs;
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
  const roles = parseRoles(meta.roles, slug);
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
//
// Two more blocks follow Aimee's panel switch (panel-audience.ts), so a
// page stays true for a reader who has the panel and one who has the
// "?" button instead (Jason, 2026-09-30):
//
//   ::: panel
//   Shown only to people who see Aimee's panel.
//   :::
//
//   ::: no-panel
//   Shown only to people who don't, yet.
//   :::
// Filtering happens server-side before the markdown ships to the
// widget — other roles' content is never in the response body.
//
// Fail-open on malformed blocks (an unclosed opener leaves its
// content intact and logs a warning) — a broken doc still shows
// something useful instead of blanking out mid-page.

const ROLE_BLOCK_OPEN = /^:::\s+role\s+(.+?)\s*$/;
const PANEL_BLOCK_OPEN = /^:::\s+(panel|no-panel)\s*$/;
const ROLE_BLOCK_CLOSE = /^:::\s*$/;

export function filterRoleSections(markdown: string, role: Role): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inBlock = false;
  let blockKeeps = false;
  let blockOpener = "";

  for (const line of lines) {
    if (!inBlock) {
      const panelMatch = line.match(PANEL_BLOCK_OPEN);
      if (panelMatch) {
        blockKeeps = seesAimeePanel(role) === (panelMatch[1] === "panel");
        inBlock = true;
        blockOpener = line;
        continue;
      }
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

// ---- Every doc, checked --------------------------------------------
//
// What would make a doc show to a role it should not, or fail to show
// to one it should. Run over every file by a test, so a mistake fails
// CI rather than shipping. The role-block filter above fails OPEN on
// an unclosed block (a broken doc still shows something), which is a
// reasonable way to render and a poor way to gate: this is what makes
// that fail-open unreachable in practice.
//
//   - frontmatter `roles:` naming a role that does not exist
//   - a `::: role` block naming a role that does not exist
//   - a `::: role`, `::: panel` or `::: no-panel` block opened and
//     never closed, or a closer with no opener
export async function helpDocProblems(): Promise<string[]> {
  const problems: string[] = [];
  const files = (await fs.readdir(HELP_DIR)).filter((f) => f.endsWith(".md") && f !== "README.md");
  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const source = await fs.readFile(path.join(HELP_DIR, file), "utf8");
    const { meta, body } = parseFrontmatter(source);
    try {
      parseRoles(meta.roles, slug);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
    let open = false;
    for (const [i, line] of body.split("\n").entries()) {
      if (PANEL_BLOCK_OPEN.test(line)) {
        if (open) problems.push(`help doc ${slug}: panel block opened inside another (line ${i + 1})`);
        open = true;
        continue;
      }
      const opener = ROLE_BLOCK_OPEN.exec(line);
      if (opener) {
        if (open) problems.push(`help doc ${slug}: role block opened inside another (line ${i + 1})`);
        open = true;
        for (const r of opener[1].split(",").map((x) => x.trim()).filter(Boolean)) {
          if (!(ROLES as readonly string[]).includes(r)) {
            problems.push(`help doc ${slug}: unknown role "${r}" in a role block (line ${i + 1})`);
          }
        }
      } else if (ROLE_BLOCK_CLOSE.test(line)) {
        if (!open) problems.push(`help doc ${slug}: role block closed without an opener (line ${i + 1})`);
        open = false;
      }
    }
    if (open) problems.push(`help doc ${slug}: a role block is never closed`);
  }
  return problems;
}
