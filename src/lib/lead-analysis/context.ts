import type { LeadCommitment, LeadIssue } from "./types";

// Pure pieces of the lead pipeline, kept apart from the model calls
// so they can be tested without one.

const DESCRIPTION_MAX = 300;
const OWNER_MAX = 80;
const NOTE_MAX = 240;
const ISSUE_MAX = 240;
const MAX_COMMITMENTS = 20;
const MAX_ISSUES = 8;

// The context block every call reads, in the shape a client meeting's
// <company_context> takes. A prospect has no purpose, values, roster
// or priorities on file, and the block says so, because the analyzer
// prompt reads their absence as "do not write Core Values in Action"
// and the speaker map reads it as "names come from the transcript".
export function leadContextBlock(input: {
  companyName: string;
  fullName: string;
  roleTitle: string | null;
}): string {
  const role = input.roleTitle?.trim();
  return [
    "<company_context>",
    `Name: ${input.companyName.trim()}`,
    "",
    "This is a leadership team meeting.",
    `The analysis was requested by ${input.fullName.trim()}${role ? `, ${role}` : ""}, ` +
      "who is likely one of the speakers.",
    "",
    "No purpose, core values, roster or priorities are on file for this company. " +
      "Take every name from the transcript itself.",
    "</company_context>",
  ].join("\n");
}

// The extraction answer, validated. Anything that fails a check is
// dropped rather than stored half-right; lengths are clipped.
export function readLeadExtraction(raw: unknown): {
  commitments: LeadCommitment[];
  issues: LeadIssue[];
} {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown, max: number): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null;

  const commitments: LeadCommitment[] = [];
  for (const c of Array.isArray(obj.commitments) ? obj.commitments : []) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const description = str(r.description, DESCRIPTION_MAX);
    if (!description) continue;
    const timeline = r.clarity_timeline === true;
    const success = r.clarity_success === true;
    commitments.push({
      owner: str(r.owner, OWNER_MAX),
      description,
      due_phrase: str(r.due_phrase, OWNER_MAX),
      clarity_timeline: timeline,
      clarity_success: success,
      // A rewrite only means something when a test failed.
      clarity_note: timeline && success ? null : str(r.clarity_note, NOTE_MAX),
    });
    if (commitments.length >= MAX_COMMITMENTS) break;
  }

  const issues: LeadIssue[] = [];
  for (const i of Array.isArray(obj.issues) ? obj.issues : []) {
    const title = i && typeof i === "object" ? str((i as Record<string, unknown>).title, ISSUE_MAX) : null;
    if (title) issues.push({ title });
    if (issues.length >= MAX_ISSUES) break;
  }
  return { commitments, issues };
}

// The headline for the Commitment quality section.
export type CommitmentQuality = {
  total: number;
  clear: number; // both tests met
  withDeadline: number;
  withDoneDefined: number;
};

export function commitmentQuality(commitments: readonly LeadCommitment[]): CommitmentQuality {
  return {
    total: commitments.length,
    clear: commitments.filter((c) => c.clarity_timeline && c.clarity_success).length,
    withDeadline: commitments.filter((c) => c.clarity_timeline).length,
    withDoneDefined: commitments.filter((c) => c.clarity_success).length,
  };
}

// A safe file name for the download: "Meeting Analysis - Acme Co - Dana Lee.pdf".
export function reportFileName(companyName: string, fullName: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return `Meeting Analysis - ${clean(companyName)} - ${clean(fullName)}.pdf`;
}
