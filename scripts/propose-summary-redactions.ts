// PROPOSE, NEVER APPLY: what the private-life rule would change in
// meetings analysed before it existed, everywhere their text appears.
//
//   npm run summaries:propose-redactions -- [--out <dir>]
//
// On 2026-10-01, 13 of production's 40 summaries named somebody's
// health, family or a bereavement (docs/investigations/open-data.md,
// phase A). New analyses are held to the rule at the write
// (transcripts/redact.ts). This applies the same functions to what is
// already stored, on every active instance:
//
//   the analysis row: the summary, the facilitation review, and the
//     meeting record's commitments, issues and missed commitments
//     (redactAnalysis, exactly as the pipeline does);
//   the Commitments and Issues pages: rows created from a meeting
//     (source_meeting_id), whose text started as the meeting's and may
//     have been edited since. Fields a person writes (a missed reason,
//     a desired outcome) are checked too, and labelled as theirs.
//
// Items are never dropped: each is reworded (transcripts/reword.ts, the
// pipeline's own call), or, where the rewrite still breaks the rule,
// kept and marked for the company admin to reword.
//
// READ ONLY. The script selects and never writes to any database. The
// only other call is the rewording model, which is sent the flagged
// lines, as the pipeline sends them. Applying a decision is a separate,
// guarded data migration through the runner, per instance, on Jason's
// go. Each proposal carries a fingerprint of every row it would change,
// so a row edited since this ran is refused rather than overwritten.
//
// THE FILES ARE PRIVATE. They quote what was said about people. They
// are written outside the repository (refused anywhere inside it),
// readable by this user only, and deleted once Jason has decided. The
// terminal shows counts only.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { forEachActiveInstance } from "@/lib/instances/for-each";
import { personalDetailMatcher, findPersonalDetail, type PersonalDetailMatcher } from "@/lib/voice/personal-detail";
import { redactAnalysis, rewordProse, settleTexts, mapStrings, type RedactableAnalysis } from "@/lib/transcripts/redact";
import { rewordWithModel, type Reword } from "@/lib/transcripts/reword";
import { transcriptModel } from "@/lib/transcripts/model";
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

type Item = { needs_rewording?: boolean };
type Fields = RedactableAnalysis<
  Item & { description: string; clarity_note?: string | null },
  Item & { title: string },
  unknown
>;

// As stored: the JSON columns can be null on old rows.
type StoredAnalysis = {
  id: string;
  meeting_id: string;
  analysis_markdown: string | null;
  commitments_json: Fields["commitments_json"] | null;
  issues_json: Fields["issues_json"] | null;
  coverage_json: CoverageReport | null;
  facilitation_review_json: unknown;
};
type PageCommitment = { id: string; source_meeting_id: string; description: string; clarity_note: string | null; missed_reason: string | null };
type PageIssue = { id: string; source_meeting_id: string; title: string; desired_outcome: string | null };

// One change, as the reader sees it. `after` null: kept as it is and
// marked for the company admin to reword. `after` "": taken out.
export type Change = {
  where: string;
  writtenBy: "AiMS" | "a person";
  before: string;
  after: string | null;
  // For the applying migration: which row, which field.
  table: "meeting_analyses" | "commitments" | "issues";
  rowId: string;
  field: string;
};

export type Proposal = {
  instance: string;
  meetingId: string;
  company: string;
  meetingDate: string;
  meetingTitle: string;
  // sha256 of each row as read, keyed "table:id". The applying
  // migration refuses a row whose fingerprint no longer matches.
  fingerprints: Record<string, string>;
  changes: Change[];
  // The analysis row's five fields as they would be stored.
  analysisAfter: Fields | null;
};

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function analysisFields(r: StoredAnalysis): Fields {
  return {
    analysis_markdown: r.analysis_markdown ?? "",
    commitments_json: r.commitments_json ?? [],
    issues_json: r.issues_json ?? [],
    coverage_json: r.coverage_json ?? null,
    facilitation_review_json: r.facilitation_review_json ?? null,
  };
}

// The analysis row: what redactAnalysis changed, as a list for the
// reader. A prose sentence is reworded or taken out.
export async function analysisChanges(
  r: StoredAnalysis,
  match: PersonalDetailMatcher,
  reword: Reword
): Promise<{ after: Fields; changes: Change[] }> {
  const before = analysisFields(r);
  const { row: after, rewrites } = await redactAnalysis(before, match, reword);
  const changes: Change[] = [];
  const base = { writtenBy: "AiMS" as const, table: "meeting_analyses" as const, rowId: r.id };
  const sentence = (where: string, field: string, s: string) =>
    changes.push({ ...base, where, field, before: s, after: rewrites.get(s) ?? "" });
  for (const f of findPersonalDetail(before.analysis_markdown, match)) {
    sentence("Summary", "analysis_markdown", f.sentence);
  }
  if (before.facilitation_review_json) {
    mapStrings(before.facilitation_review_json, (t) => {
      for (const f of findPersonalDetail(t, match)) sentence("Facilitation review", "facilitation_review_json", f.sentence);
      return t;
    });
  }
  const item = (where: string, field: string, b: string, a: string, marked: boolean | undefined) => {
    if (marked) changes.push({ ...base, where, field, before: b, after: null });
    else if (a !== b) changes.push({ ...base, where, field, before: b, after: a });
  };
  before.commitments_json.forEach((c, i) => {
    const a = after.commitments_json[i];
    item("Meeting record: commitment", "commitments_json", c.description, a.description, a.needs_rewording);
    for (const f of findPersonalDetail(c.clarity_note ?? "", match)) {
      sentence("Meeting record: clarity note", "commitments_json", f.sentence);
    }
  });
  before.issues_json.forEach((iss, i) => {
    const a = after.issues_json[i];
    item("Meeting record: issue", "issues_json", iss.title, a.title, a.needs_rewording);
  });
  (before.coverage_json?.missed ?? []).forEach((m, i) => {
    const a = after.coverage_json!.missed[i];
    item("Meeting record: missed commitment", "coverage_json", `"${m.quote}" (${m.reason})`, `"${a.quote}" (${a.reason})`, a.needs_rewording);
  });
  return { after, changes };
}

// The Commitments and Issues pages: one rewording call for the
// meeting's rows, through the same settleTexts as the analysis.
export async function pageChanges(
  commitments: readonly PageCommitment[],
  issues: readonly PageIssue[],
  match: PersonalDetailMatcher,
  reword: Reword
): Promise<Change[]> {
  type Line = Omit<Change, "after">;
  const lines: Line[] = [];
  for (const c of commitments) {
    lines.push({ where: "Commitments page: description", writtenBy: "AiMS", before: c.description, table: "commitments", rowId: c.id, field: "description" });
    if (c.missed_reason) {
      lines.push({ where: "Commitments page: missed reason", writtenBy: "a person", before: c.missed_reason, table: "commitments", rowId: c.id, field: "missed_reason" });
    }
  }
  for (const i of issues) {
    lines.push({ where: "Issues page: title", writtenBy: "AiMS", before: i.title, table: "issues", rowId: i.id, field: "title" });
    if (i.desired_outcome) {
      lines.push({ where: "Issues page: desired outcome", writtenBy: "a person", before: i.desired_outcome, table: "issues", rowId: i.id, field: "desired_outcome" });
    }
  }
  const settled = await settleTexts(lines.map((l) => l.before), match, reword);
  const changes: Change[] = [];
  lines.forEach((l, k) => {
    const s = settled[k];
    if (s.needsRewording) changes.push({ ...l, after: null });
    else if (s.reworded) changes.push({ ...l, after: s.text });
  });
  // A clarity note is advice, not the commitment: prose, so a sentence
  // is reworded or taken out.
  for (const c of commitments) {
    if (!c.clarity_note) continue;
    const r = await rewordProse([c.clarity_note], match, reword);
    if (r.texts[0] !== c.clarity_note) {
      changes.push({ where: "Commitments page: clarity note", writtenBy: "AiMS", before: c.clarity_note, after: r.texts[0], table: "commitments", rowId: c.id, field: "clarity_note" });
    }
  }
  return changes;
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

export type Totals = { meetings: number; removed: number; reworded: number; marked: number; byPerson: number };

export function totals(proposals: readonly Proposal[]): Totals {
  const all = proposals.flatMap((p) => p.changes);
  return {
    meetings: proposals.length,
    removed: all.filter((c) => c.after === "").length,
    reworded: all.filter((c) => c.after !== null && c.after !== "").length,
    marked: all.filter((c) => c.after === null).length,
    byPerson: all.filter((c) => c.writtenBy === "a person").length,
  };
}

function markdownFor(instance: string, proposals: Proposal[], checked: number): string {
  const t = totals(proposals);
  const lines = [
    `# Proposed changes: ${instance}`,
    "",
    "Private. Delete this file once decided.",
    "",
    `${checked} meetings checked; ${t.meetings} with something to change. ` +
      `${t.removed} sentences taken out, ${t.reworded} lines reworded, ${t.marked} kept and marked for the company admin to reword. ` +
      `${t.byPerson} of these are in fields a person wrote.`,
    "",
  ];
  for (const p of proposals) {
    lines.push(`## ${p.meetingDate} · ${p.company} · ${p.meetingTitle}`, "", `Meeting ${p.meetingId}`, "");
    for (const c of p.changes) {
      const who = c.writtenBy === "a person" ? " (written by a person)" : "";
      if (c.after === "") lines.push(`- **${c.where}**${who}: take out "${c.before}"`);
      else if (c.after === null) lines.push(`- **${c.where}**${who}: "${c.before}" → keep, mark for the company admin to reword`);
      else lines.push(`- **${c.where}**${who}: "${c.before}" → "${c.after}"`);
    }
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
  const reword = rewordWithModel(new Anthropic(), transcriptModel());

  const summary = await forEachActiveInstance<{ checked: number; proposals: Proposal[]; file: string | null }>({
    job: "summary-redactions",
    run: async ({ admin, instance }) => {
      const [analyses, meetings, people, companies, commitments, issues] = await Promise.all([
        admin
          .from("meeting_analyses")
          .select("id, meeting_id, analysis_markdown, commitments_json, issues_json, coverage_json, facilitation_review_json"),
        admin.from("meetings").select("id, company_id, created_at, meeting_title, file_name"),
        admin.from("profiles").select("full_name, company_id").not("company_id", "is", null),
        admin.from("companies").select("id, name"),
        admin
          .from("commitments")
          .select("id, source_meeting_id, description, clarity_note, missed_reason")
          .not("source_meeting_id", "is", null),
        admin.from("issues").select("id, source_meeting_id, title, desired_outcome").not("source_meeting_id", "is", null),
      ]);
      for (const r of [analyses, meetings, people, companies, commitments, issues]) if (r.error) throw new Error(r.error.message);

      type MeetingRow = { id: string; company_id: string | null; created_at: string; meeting_title: string | null; file_name: string };
      const meetingRows = (meetings.data ?? []) as MeetingRow[];
      const companyName = new Map((companies.data ?? []).map((c) => [c.id as string, c.name as string]));
      const roster = new Map<string, string[]>();
      for (const p of people.data ?? []) {
        if (!p.full_name) continue;
        roster.set(p.company_id as string, [...(roster.get(p.company_id as string) ?? []), p.full_name as string]);
      }
      const analysisByMeeting = new Map(((analyses.data ?? []) as StoredAnalysis[]).map((a) => [a.meeting_id, a]));
      const group = <T extends { source_meeting_id: string }>(rows: T[]) => {
        const m = new Map<string, T[]>();
        for (const r of rows) m.set(r.source_meeting_id, [...(m.get(r.source_meeting_id) ?? []), r]);
        return m;
      };
      const commitmentsByMeeting = group((commitments.data ?? []) as PageCommitment[]);
      const issuesByMeeting = group((issues.data ?? []) as PageIssue[]);

      const proposals: Proposal[] = [];
      let checked = 0;
      for (const meeting of meetingRows) {
        const analysis = analysisByMeeting.get(meeting.id);
        const pageCommitments = commitmentsByMeeting.get(meeting.id) ?? [];
        const pageIssues = issuesByMeeting.get(meeting.id) ?? [];
        if (!analysis && pageCommitments.length === 0 && pageIssues.length === 0) continue;
        checked++;
        const match = personalDetailMatcher({ mode: "record", people: roster.get(meeting.company_id ?? "") ?? [] });

        const fromAnalysis = analysis ? await analysisChanges(analysis, match, reword) : null;
        const fromPages = await pageChanges(pageCommitments, pageIssues, match, reword);
        const changes = [...(fromAnalysis?.changes ?? []), ...fromPages];
        if (changes.length === 0) continue;

        const fingerprints: Record<string, string> = {};
        if (analysis) fingerprints[`meeting_analyses:${analysis.id}`] = fingerprint(analysisFields(analysis));
        for (const c of pageCommitments) fingerprints[`commitments:${c.id}`] = fingerprint(c);
        for (const i of pageIssues) fingerprints[`issues:${i.id}`] = fingerprint(i);

        proposals.push({
          instance: instanceLabel(instance.subdomain),
          meetingId: meeting.id,
          company: companyName.get(meeting.company_id ?? "") ?? "(no company)",
          meetingDate: meeting.created_at.slice(0, 10),
          meetingTitle: meeting.meeting_title ?? meeting.file_name,
          fingerprints,
          changes,
          analysisAfter: fromAnalysis?.after ?? null,
        });
      }
      proposals.sort((a, b) => a.meetingDate.localeCompare(b.meetingDate));

      let file: string | null = null;
      if (proposals.length > 0) {
        const base = path.join(dir, `${stamp}-${instanceLabel(instance.subdomain)}`);
        writeFileSync(`${base}.md`, markdownFor(instanceLabel(instance.subdomain), proposals, checked), { mode: 0o600 });
        writeFileSync(`${base}.json`, JSON.stringify(proposals, null, 2), { mode: 0o600 });
        file = `${base}.md`;
      }
      return { checked, proposals, file };
    },
    // Counts only: the terminal and the log never show what was said.
    line: ({ checked, proposals, file }) => {
      const t = totals(proposals);
      const byWhere = new Map<string, number>();
      for (const c of proposals.flatMap((p) => p.changes)) {
        const area = c.where.split(":")[0];
        byWhere.set(area, (byWhere.get(area) ?? 0) + 1);
      }
      return (
        `${checked} meetings checked, ${t.meetings} with something to change: ` +
        `${t.removed} sentence(s) taken out, ${t.reworded} line(s) reworded, ${t.marked} kept and marked; ` +
        `${t.byPerson} in fields a person wrote. By place: ` +
        [...byWhere].map(([k, n]) => `${k} ${n}`).join(", ") +
        (file ? `. Proposals in ${file}` : "")
      );
    },
  });

  process.exit(summary.ok ? 0 : 1);
}

if (isEntryPoint(import.meta.url)) {
  void main();
}
