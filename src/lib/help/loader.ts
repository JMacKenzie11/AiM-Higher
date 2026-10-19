import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { ROLES, type Role } from "@/lib/types";
import { mcpEnabled, mcpOpenTo } from "@/lib/mcp/switch";
import { SIMPLIFY_CHANGES, simplifyOn, type SimplifyChange } from "@/lib/ui/simplify";

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
export async function loadAllHelpFor(role: Role, viewer?: HelpViewer): Promise<HelpDoc[]> {
  const v = viewer ?? (await currentHelpViewer());
  const features = new Set<string>([...helpFeaturesFor(role, v), ...uiHelpFeatures()]);
  const files = (await fs.readdir(HELP_DIR)).filter((f) => f.endsWith(".md") && f !== "README.md");
  const docs: HelpDoc[] = [];
  for (const file of files.sort()) {
    const doc = await readDoc(file.replace(/\.md$/, ""));
    if (!doc) continue;
    if (doc.roles && !doc.roles.includes(role)) continue;
    docs.push({ ...doc, markdown: withMcpAddress(filterFeatureSections(filterRoleSections(doc.markdown, role), features), v) });
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
// Filtering happens server-side before the markdown reaches Aimee:
// other roles' content is never in what she reads.
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

// ---- Feature-scoped section filter ----------------------------------
//
// Help for a feature a viewer cannot use is not shown to them (Jason,
// 2026-10-14: "Clients must not see help for a feature they can't
// use"). Same shape as a role block:
//
//   ::: feature outside_assistants
//   Content only people with outside assistants switched on see.
//   :::
//
// FAILS CLOSED, unlike a role block: an unclosed feature block drops
// everything after its opener, because showing a hidden feature's help
// is the thing this exists to prevent. helpDocProblems() makes that
// unreachable in practice by failing CI on an unclosed block.
//
// Known features:
//   outside_assistants   MCP is on for this instance (MCP_ENABLED,
//                        MCP_INSTANCES), the viewer's role is open to
//                        it (every role but portfolio admins), and,
//                        for anyone but a system admin, a company they
//                        belong to or are assigned to has AI apps
//                        switched on (0279).
//   ai_apps_off          the same, except that no such company has them
//                        on: the help then says they are switched off
//                        and to ask the company admin (Jason,
//                        2026-10-14). Never for a system admin, who
//                        needs no company switch to read the help.
//
// `{{mcp_address}}` in a doc is replaced with this instance's AI app
// server address (`<origin>/api/mcp`), so the one article in
// docs/help/ai-apps.md serves the drawer and Aimee with the address
// for wherever the person is.

export const HELP_FEATURES = ["outside_assistants", "ai_apps_off"] as const;

// The simplification switches (src/lib/ui/simplify.ts), so a help doc
// can describe whichever UI is on: `::: feature ui_main_action` shows
// while the "main-action" change is on, `::: feature ui_main_action_off`
// while it is off. Underscores, as feature names take no hyphens.
// When a change is decided, its blocks go with its switch.
function uiFeatureName(change: SimplifyChange): string {
  return `ui_${change.replace(/-/g, "_")}`;
}
export const UI_HELP_FEATURES: readonly string[] = SIMPLIFY_CHANGES.flatMap((c) => [
  uiFeatureName(c),
  `${uiFeatureName(c)}_off`,
]);
export function uiHelpFeatures(): Set<string> {
  return new Set(SIMPLIFY_CHANGES.map((c) => (simplifyOn(c) ? uiFeatureName(c) : `${uiFeatureName(c)}_off`)));
}
export type HelpFeature = (typeof HELP_FEATURES)[number];

export type HelpViewer = {
  // The request's instance, for MCP_INSTANCES.
  subdomain?: string;
  // Whether a company the viewer belongs to, or is assigned to as a
  // guide, has AI apps on.
  companyAssistantsOn: boolean;
  // This instance's AI app server address, for {{mcp_address}}.
  mcpAddress?: string;
};

export const MCP_ADDRESS_PLACEHOLDER = "{{mcp_address}}";

// The address where it is known; otherwise a description of where to
// find it, so a doc never shows the raw placeholder.
export function withMcpAddress(markdown: string, viewer?: HelpViewer): string {
  if (!markdown.includes(MCP_ADDRESS_PLACEHOLDER)) return markdown;
  return markdown.split(MCP_ADDRESS_PLACEHOLDER).join(viewer?.mcpAddress ?? "your AiMS HQ address followed by /api/mcp");
}

export function helpFeaturesFor(role: Role, viewer: HelpViewer): Set<HelpFeature> {
  const on = new Set<HelpFeature>();
  if (!mcpEnabled(viewer.subdomain) || !mcpOpenTo(role)) return on;
  on.add(role === "system_admin" || viewer.companyAssistantsOn ? "outside_assistants" : "ai_apps_off");
  return on;
}

// The viewer, from the request: its instance, and its own company's
// switch read as the viewer. Anything that cannot be read leaves the
// feature off (fail closed): help is hidden, never shown by accident.
export async function currentHelpViewer(): Promise<HelpViewer> {
  try {
    const { getCurrentInstanceConfig } = await import("@/lib/instances/current");
    const { getCurrentSession } = await import("@/lib/auth/current-user");
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const instance = await getCurrentInstanceConfig();
    const { currentRequestOrigin } = await import("@/lib/instances/origin");
    const session = await getCurrentSession();
    let companyAssistantsOn = false;
    if (session?.profile) {
      // As the viewer, so RLS limits it to the companies they can see:
      // their own, or for a guide the companies they are assigned to.
      // A guide has no home company, and reading only that left them
      // with no AI app help anywhere.
      const db = await createSupabaseServerClient(instance);
      const { data } = await db.from("companies").select("id").eq("assistants_enabled", true).limit(1);
      companyAssistantsOn = (data ?? []).length > 0;
    }
    return { subdomain: instance.subdomain, companyAssistantsOn, mcpAddress: `${await currentRequestOrigin()}/api/mcp` };
  } catch {
    return { subdomain: undefined, companyAssistantsOn: false };
  }
}

const FEATURE_BLOCK_OPEN = /^:::\s+feature\s+([a-z_]+)\s*$/;

export function filterFeatureSections(markdown: string, enabled: ReadonlySet<string>): string {
  const out: string[] = [];
  let inBlock = false;
  let keep = false;
  for (const line of markdown.split("\n")) {
    if (!inBlock) {
      const m = FEATURE_BLOCK_OPEN.exec(line);
      if (m) {
        inBlock = true;
        keep = enabled.has(m[1]);
        continue;
      }
      out.push(line);
      continue;
    }
    if (ROLE_BLOCK_CLOSE.test(line)) {
      inBlock = false;
      keep = false;
      continue;
    }
    if (keep) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

// Resolve the most specific help doc that (a) exists and (b) is
// visible to the caller's role. Applies section-level role filters
// before returning so the response contains only what this role
// should see.
export async function loadHelpForRoute(
  pathname: string,
  role: Role,
  viewer?: HelpViewer
): Promise<HelpDoc | null> {
  const v = viewer ?? (await currentHelpViewer());
  const features = new Set<string>([...helpFeaturesFor(role, v), ...uiHelpFeatures()]);
  for (const slug of candidateSlugs(pathname)) {
    const doc = await readDoc(slug);
    if (!doc) continue;
    if (doc.roles && !doc.roles.includes(role)) continue;
    return { ...doc, markdown: withMcpAddress(filterFeatureSections(filterRoleSections(doc.markdown, role), features), v) };
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
//   - a `::: role` block opened and never closed, or a closer with no
//     opener
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
      const feature = FEATURE_BLOCK_OPEN.exec(line);
      if (feature) {
        if (open) problems.push(`help doc ${slug}: block opened inside another (line ${i + 1})`);
        open = true;
        if (!(HELP_FEATURES as readonly string[]).includes(feature[1]) && !UI_HELP_FEATURES.includes(feature[1])) {
          problems.push(`help doc ${slug}: unknown feature "${feature[1]}" in a feature block (line ${i + 1})`);
        }
        continue;
      }
      if (/^:::\s+feature\b/.test(line)) {
        problems.push(`help doc ${slug}: malformed feature block opener (line ${i + 1})`);
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
