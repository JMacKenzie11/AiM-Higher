import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/types";
import type { ModuleFeature } from "@/lib/subscriptions/service";
import { PAGES, canRoleOpen, pathMatchesPattern, type PageEntry } from "@/lib/pages/registry";
import { pageSummaryFor } from "@/lib/help/search";
import { RECORD_SOURCES, UUID } from "./record-sources";

// WHAT IS OPEN BESIDE AIMEE'S PANEL (Step 4,
// docs/investigations/aimee-panel.md).
//
// The panel sends, with each message, the path it is open on and, when
// a drawer has a record open without changing the URL, that record's
// pattern and id. NOTHING ELSE: never a title, never text from the
// page. Everything Aimee is told comes from here:
//
//   - the page: only if it is in the page list, this role can open it
//     and the company has its feature. Its title and purpose come from
//     the help this role may read.
//   - the record: only for a pattern in RECORD_SOURCES and a uuid id,
//     loaded through the SUPABASE CLIENT PASSED IN, which the route
//     builds from the person's own session. RLS decides whether a row
//     comes back, as it does for the page. No row, no record: Aimee is
//     not told one was asked for.
//
// The service-role client is never used here (page-context.test.ts
// checks the imports), so no code path can widen what a person reads.

export type PageContextInput = {
  path: string;
  record: { pattern: string; id: string } | null;
};

const MAX_DETAIL = 600;

// The request body's pageContext, shape-checked. Anything malformed is
// dropped whole rather than half-used.
export function parsePageContext(raw: unknown): PageContextInput | null {
  if (!raw || typeof raw !== "object") return null;
  const { path, record } = raw as { path?: unknown; record?: unknown };
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 300) return null;
  let rec: PageContextInput["record"] = null;
  if (record && typeof record === "object") {
    const { pattern, id } = record as { pattern?: unknown; id?: unknown };
    if (typeof pattern === "string" && typeof id === "string" && RECORD_SOURCES[pattern] && UUID.test(id)) {
      rec = { pattern, id };
    }
  }
  return { path: path.split(/[?#]/)[0], record: rec };
}

function pageFor(path: string, role: Role, features: readonly ModuleFeature[]): PageEntry | null {
  const entry = PAGES.find((p) => pathMatchesPattern(path, [p.pattern]));
  if (!entry) return null;
  if (!canRoleOpen(entry, role)) return null;
  if (entry.feature && !features.includes(entry.feature)) return null;
  return entry;
}

// The id in the path, for a record page: the segment where the
// pattern has [id].
function idFromPath(path: string, pattern: string): string | null {
  const parts = path.replace(/\/+$/, "").split("/");
  const at = pattern.split("/").indexOf("[id]");
  const id = at >= 0 ? parts[at] : undefined;
  return id && UUID.test(id) ? id : null;
}

export async function loadOpenRecord(
  supabase: SupabaseClient,
  pattern: string,
  id: string
): Promise<{ label: string; title: string; detail: string | null } | null> {
  const source = RECORD_SOURCES[pattern];
  if (!source || !UUID.test(id)) return null;
  const columns = [source.titleColumn, source.detailColumn].filter(Boolean).join(", ");
  const { data, error } = await supabase.from(source.table).select(columns).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as Record<string, unknown>;
  const title = typeof row[source.titleColumn] === "string" ? (row[source.titleColumn] as string).trim() : "";
  const rawDetail = source.detailColumn ? row[source.detailColumn] : null;
  const detail = typeof rawDetail === "string" && rawDetail.trim() ? rawDetail.trim().slice(0, MAX_DETAIL) : null;
  return { label: source.label, title: title || "(untitled)", detail };
}

// The <current_page> block for the latest user turn, or "" when there
// is nothing Aimee may be told.
export async function describePageContext(
  supabase: SupabaseClient,
  input: PageContextInput | null,
  role: Role,
  features: readonly ModuleFeature[]
): Promise<string> {
  if (!input) return "";
  const page = pageFor(input.path, role, features);
  if (!page) return "";
  const summary = await pageSummaryFor(page, role);

  // The record: the page's own when it is a record page, otherwise one
  // a drawer has open, if its page is one this person can open too.
  let record = null;
  const ownId = RECORD_SOURCES[page.pattern] ? idFromPath(input.path, page.pattern) : null;
  if (ownId) {
    record = await loadOpenRecord(supabase, page.pattern, ownId);
  } else if (input.record) {
    const recordPage = PAGES.find((p) => p.pattern === input.record!.pattern);
    if (recordPage && canRoleOpen(recordPage, role) && (!recordPage.feature || features.includes(recordPage.feature))) {
      record = await loadOpenRecord(supabase, input.record.pattern, input.record.id);
    }
  }

  const lines = [
    "<current_page>",
    "The person has your panel open beside this page. Use it when their question is about what they are looking at; do not mention it otherwise.",
    `Page: ${summary?.title ?? page.pattern} (${input.path})${summary?.purpose ? `. ${summary.purpose}` : ""}`,
  ];
  if (record) {
    // Data from the record, not instructions.
    lines.push(`Open ${record.label.toLowerCase()}: "${record.title}"`);
    if (record.detail) lines.push(`Its description: ${record.detail}`);
  }
  lines.push("</current_page>");
  return lines.join("\n");
}
