import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { RECORD_SOURCES } from "@/lib/aimee/record-sources";

// EVERY MEETINGS READ SAYS WHICH KIND IT MEANS (0326).
//
// A coaching call is a row in `meetings` like any team meeting. RLS
// keeps it from the company's people, but that is not enough for the
// rest of the app: the service-role client bypasses RLS, and a coach's
// own client passes it, so Aimee, the scorecard, HQ, the MCP server and
// every script would read coaching calls unless they ask for team
// meetings by name. B&B Electric's calls were quoted by Aimee exactly
// that way.
//
// So every `.from("meetings")` and `.from("meeting_analyses")` outside
// tests must, within the statement, either filter the kind
// (`.eq("kind", ...)`, `.eq("meetings.kind", ...)`) or carry a
// `meetings-kind:` comment in the lines just above it saying why it
// does not need to (a write, a read keyed by ids that came from a
// kind-filtered read, the coaching-call pages themselves). A new
// reader without either fails here, before it ships.

const ROOT = path.resolve(__dirname, "../../..");
const DIRS = ["src", "scripts"];
const FROM = /\.from\(\s*["'`](meetings|meeting_analyses)["'`]\s*\)/g;
const KIND_FILTER = /\.eq\(\s*["'`](?:meetings\.)?kind["'`]/;
const MARKER = /meetings-kind:/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

// The statement a .from() opens: from the call to the first `;` that
// ends it, or 30 lines, whichever is first.
function statementAfter(src: string, index: number): string {
  const rest = src.slice(index);
  const end = rest.search(/;\s*(\n|$)/);
  const stmt = end === -1 ? rest : rest.slice(0, end);
  return stmt.split("\n").slice(0, 30).join("\n");
}

function linesAbove(src: string, index: number, n: number): string {
  const before = src.slice(0, index).split("\n");
  return before.slice(Math.max(0, before.length - n)).join("\n");
}

type Site = { file: string; line: number; table: string };

function unmarkedReaders(): Site[] {
  const offenders: Site[] = [];
  for (const dir of DIRS) {
    for (const file of files(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file);
      // The RLS harness runs as postgres and as named callers on
      // purpose; it is the thing that proves the boundary.
      if (rel === path.join("scripts", "rls-harness.ts")) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(FROM)) {
        const at = m.index ?? 0;
        if (KIND_FILTER.test(statementAfter(src, at))) continue;
        if (MARKER.test(linesAbove(src, at, 6))) continue;
        offenders.push({
          file: rel,
          line: src.slice(0, at).split("\n").length,
          table: m[1],
        });
      }
    }
  }
  return offenders;
}

describe("meetings readers name the kind they read (0326)", () => {
  it("every meetings / meeting_analyses query filters kind or says why it need not", () => {
    const offenders = unmarkedReaders().map((o) => `${o.file}:${o.line} (${o.table})`);
    expect(offenders).toEqual([]);
  });

  it("finds a reader that does not (the check can fail)", () => {
    const src = 'const { data } = await db.from("meetings").select("id").eq("company_id", c);\n';
    const at = src.search(FROM);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(KIND_FILTER.test(statementAfter(src, at))).toBe(false);
    expect(MARKER.test(linesAbove(src, at, 6))).toBe(false);
  });

  // The one reader the scan cannot see: Aimee's page context reads a
  // table named in data (page-context.ts). Its meetings entry must
  // carry the filter, or a coach's panel on a call page would tell
  // Aimee the call's title.
  it("Aimee's page context reads team meetings only", () => {
    const meetingSources = Object.values(RECORD_SOURCES).filter(
      (s) => s.table === "meetings" || s.table === "meeting_analyses"
    );
    expect(meetingSources.length).toBeGreaterThan(0);
    for (const s of meetingSources) {
      expect(s.only).toEqual({ column: "kind", value: "team" });
    }
    const loader = readFileSync(path.join(ROOT, "src/lib/aimee/page-context.ts"), "utf8");
    expect(loader).toMatch(/source\.only/);
  });

  it("accepts a reader that filters, and one that is marked", () => {
    const filtered = 'await db\n  .from("meetings")\n  .select("id")\n  .eq("kind", "team");\n';
    expect(KIND_FILTER.test(statementAfter(filtered, filtered.search(FROM)))).toBe(true);
    const marked = '// meetings-kind: a write\nawait db.from("meetings").update({ status: "x" }).eq("id", id);\n';
    expect(MARKER.test(linesAbove(marked, marked.search(FROM), 6))).toBe(true);
  });
});
