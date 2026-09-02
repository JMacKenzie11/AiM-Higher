// What the Commitment column shows for a row in the Resolved issues
// table on /issues.
//
// Pulled out of ResolvedIssuesList as a pure function so the rule is
// testable: the project has no DOM test tooling (vitest runs
// node-only, no testing-library), so a rule left inline in a
// component is a rule with no regression cover.
//
// Three outcomes, in priority order:
//   commitment  — a commitment landed on the issue; show its text.
//                 Takes precedence even on a resolved-in-meeting row,
//                 on the off chance one was linked afterwards: real
//                 work beats a provenance label.
//   in-meeting  — no commitment, and the issue was closed by the
//                 meeting-summary "Resolved in meeting" shortcut.
//                 Say so, rather than showing a dash that reads as
//                 missing data.
//   empty       — no commitment and no known provenance. Em-dash.

export type ResolvedCommitmentCell =
  | { kind: "commitment"; text: string }
  | { kind: "in-meeting" }
  | { kind: "empty" };

export function resolvedCommitmentCell(args: {
  // The representative (newest) commitment on the issue, if any.
  commitmentDescription: string | null | undefined;
  // issues.resolved_in_meeting. Optional because the column arrives
  // in migration 0162 and the loader selects "*": before that
  // migration runs the field is simply absent.
  resolvedInMeeting: boolean | undefined;
}): ResolvedCommitmentCell {
  const text = args.commitmentDescription?.trim();
  if (text) return { kind: "commitment", text };
  if (args.resolvedInMeeting === true) return { kind: "in-meeting" };
  return { kind: "empty" };
}
