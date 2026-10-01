// PROPOSE, NEVER APPLY: what the private-life rule would take out of
// meeting analyses stored before it existed.
//
//   npm run summaries:propose-redactions -- [--out <dir>]
//
// On 2026-10-01, 13 of production's 40 summaries named somebody's
// health, family or a bereavement (docs/investigations/open-data.md,
// phase A). New analyses are held to the rule at the write
// (transcripts/redact.ts). This applies the same function to every
// stored row, on every active instance, and writes what it would
// change to files for Jason to read and decide on.
//
// READ ONLY. The script selects and never writes to any database.
// Applying a decision is a separate, guarded data migration through
// the runner, per instance, on Jason's go. The `fingerprint` on each
// proposal is what that migration checks, so a row that changed since
// this ran is refused rather than overwritten.
//
// THE FILES ARE PRIVATE. They quote what the summaries said about
// people. They are written outside the repository (refused anywhere
// inside it), readable by this user only, and deleted once Jason has
// decided. The terminal shows counts only.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { forEachActiveInstance } from "@/lib/instances/for-each";
import { personalDetailMatcher, findPersonalDetail, type PersonalDetailMatcher } from "@/lib/voice/personal-detail";
import { redactAnalysis, redactionCount, mapStrings, type RedactableAnalysis, type RedactionCounts } from "@/lib/transcripts/redact";
import type { CoverageReport } from "@/lib/transcripts/coverage";
import { isEntryPoint } from "./lib/entry-point.ts";

for (const f of [".env.provisioning", ".env.local"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

type Fields = RedactableAnalysis<{ description: string }, { title: string }, unknown>;

// As stored: the JSON columns can be null on old rows.
type StoredRow = {
  id: string;
  meeting_id: string;
  analysis_markdown: string | null;
  commitments_json: Array<{ description: string }> | null;
  issues_json: Array<{ title: string }> | null;
  coverage_json: CoverageReport | null;
  facilitation_review_json: unknown;
};

export type Proposal = {
  instance: string;
  analysisId: string;
  meetingId: string;
  company: string;
  meetingDate: string;
  meetingTitle: string;
  // sha256 of the five fields as stored, for the applying migration.
  fingerprint: string;
  counts: RedactionCounts;
  // What would go, for the reader: sentences and whole items.
  removed: string[];
  // The five fields as they would be stored.
  after: Fields;
};

export function fingerprint(row: Fields): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.analysis_markdown,
        row.commitments_json,
        row.issues_json,
        row.coverage_json,
        row.facilitation_review_json,
      ])
    )
    .digest("hex");
}

// Every sentence and item the rule would take out, in reading order.
export function removedText(row: Fields, match: PersonalDetailMatcher): string[] {
  const out: string[] = [];
  const prose = (t: string) => {
    for (const f of findPersonalDetail(t, match)) out.push(f.sentence);
    return t;
  };
  prose(row.analysis_markdown);
  for (const c of row.commitments_json) if (match(c.description)) out.push(`Commitment: ${c.description}`);
  for (const i of row.issues_json) if (match(i.title)) out.push(`Issue: ${i.title}`);
  for (const m of row.coverage_json?.missed ?? []) {
    if (match(`${m.quote} ${m.reason}`)) out.push(`Missed commitment: "${m.quote}" (${m.reason})`);
  }
  if (row.facilitation_review_json) mapStrings(row.facilitation_review_json, prose);
  return out;
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Anywhere outside the repository. Checked before anything is created,
// and again on the real path after, so a symlink into the repo is
// refused too.
export function privateDir(out: string, repoRoot: string): string {
  if (!out) throw new Error("--out needs a folder");
  const dir = path.resolve(out.replace(/^~(?=$|\/)/, homedir()));
  const root = realpathSync(repoRoot);
  const refuse = (p: string) =>
    new Error(`refusing to write inside the repository (${p}). Use --out with a folder outside it.`);
  if (isInside(dir, root) || isInside(dir, repoRoot)) throw refuse(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const real = realpathSync(dir);
  if (isInside(real, root)) throw refuse(real);
  return real;
}

// The root instance has no subdomain; the runner calls it "@".
const instanceLabel = (subdomain: string) => subdomain || "root";

function markdownFor(instance: string, proposals: Proposal[], checked: number): string {
  const lines = [
    `# Proposed removals: ${instance}`,
    "",
    `Private. Delete this file once decided. ${checked} analyses checked, ${proposals.length} with something to remove.`,
    "",
  ];
  for (const p of proposals) {
    lines.push(`## ${p.meetingDate} · ${p.company} · ${p.meetingTitle}`, "");
    lines.push(`Analysis ${p.analysisId} (meeting ${p.meetingId})`, "");
    for (const r of p.removed) lines.push(`- ${r}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const outArg = args.indexOf("--out");
  const dir = privateDir(
    outArg === -1 ? "~/AiMS-private/summary-redactions" : (args[outArg + 1] ?? ""),
    process.cwd()
  );
  const stamp = new Date().toISOString().slice(0, 10);

  const summary = await forEachActiveInstance<{ checked: number; proposals: Proposal[]; file: string | null }>({
    job: "summary-redactions",
    run: async ({ admin, instance }) => {
      const [analyses, meetings, people, companies] = await Promise.all([
        admin
          .from("meeting_analyses")
          .select("id, meeting_id, analysis_markdown, commitments_json, issues_json, coverage_json, facilitation_review_json"),
        admin.from("meetings").select("id, company_id, created_at, meeting_title, file_name"),
        admin.from("profiles").select("full_name, company_id").not("company_id", "is", null),
        admin.from("companies").select("id, name"),
      ]);
      for (const r of [analyses, meetings, people, companies]) if (r.error) throw new Error(r.error.message);

      const meetingById = new Map(
        (meetings.data ?? []).map((m) => [m.id as string, m as { company_id: string | null; created_at: string; meeting_title: string | null; file_name: string }])
      );
      const companyName = new Map((companies.data ?? []).map((c) => [c.id as string, c.name as string]));
      const rosterByCompany = new Map<string, string[]>();
      for (const p of people.data ?? []) {
        const list = rosterByCompany.get(p.company_id as string) ?? [];
        if (p.full_name) list.push(p.full_name as string);
        rosterByCompany.set(p.company_id as string, list);
      }

      const proposals: Proposal[] = [];
      const rows = (analyses.data ?? []) as StoredRow[];
      for (const r of rows) {
        const meeting = meetingById.get(r.meeting_id);
        const match = personalDetailMatcher({
          mode: "record",
          people: rosterByCompany.get(meeting?.company_id ?? "") ?? [],
        });
        const fields: Fields = {
          analysis_markdown: r.analysis_markdown ?? "",
          commitments_json: r.commitments_json ?? [],
          issues_json: r.issues_json ?? [],
          coverage_json: r.coverage_json ?? null,
          facilitation_review_json: r.facilitation_review_json ?? null,
        };
        const { row: after, counts } = redactAnalysis(fields, match);
        if (redactionCount(counts) === 0) continue;
        proposals.push({
          instance: instanceLabel(instance.subdomain),
          analysisId: r.id,
          meetingId: r.meeting_id,
          company: companyName.get(meeting?.company_id ?? "") ?? "(no company)",
          meetingDate: meeting?.created_at.slice(0, 10) ?? "",
          meetingTitle: meeting?.meeting_title ?? meeting?.file_name ?? "",
          fingerprint: fingerprint(fields),
          counts,
          removed: removedText(fields, match),
          after,
        });
      }
      proposals.sort((a, b) => a.meetingDate.localeCompare(b.meetingDate));

      let file: string | null = null;
      if (proposals.length > 0) {
        const base = path.join(dir, `${stamp}-${instanceLabel(instance.subdomain)}`);
        writeFileSync(`${base}.md`, markdownFor(instanceLabel(instance.subdomain), proposals, rows.length), { mode: 0o600 });
        writeFileSync(`${base}.json`, JSON.stringify(proposals, null, 2), { mode: 0o600 });
        file = `${base}.md`;
      }
      return { checked: rows.length, proposals, file };
    },
    // Counts only: the terminal and the log never show what was said.
    line: ({ checked, proposals, file }) => {
      const sum = (k: keyof RedactionCounts) => proposals.reduce((n, p) => n + p.counts[k], 0);
      return (
        `${checked} analyses checked, ${proposals.length} with something to remove ` +
        `(${sum("sentences")} sentence(s), ${sum("commitments")} commitment(s), ${sum("issues")} issue(s), ` +
        `${sum("missed")} missed commitment(s))${file ? `; proposals in ${file}` : ""}`
      );
    },
  });

  process.exit(summary.ok ? 0 : 1);
}

if (isEntryPoint(import.meta.url)) {
  void main();
}
