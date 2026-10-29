import type { DiagnosticStatus } from "./types";

// THE PEOPLE INTERVIEWS ARE HIDDEN (Jason, 2026-10-29): the survey,
// the conversations, the people in scope, the owner's pledge and the
// quotes, so the diagnostic is about systems and process. Hidden, not
// removed: the steps, their pages and their tables stay, and setting
// this to true brings every one of them back. A readout already
// published keeps the sections it was published with.
export const INTERVIEWS_SHOWN = false;

// Every step a Capacity Diagnostic can run, in order. The step rides in
// the URL, as the weekly meeting's does (meeting/steps.ts). `lead` is
// the line under the page title.
const ALL_STEPS = [
  { key: "preflight", label: "Pre-flight", lead: INTERVIEWS_SHOWN ? "Secure tool access before kickoff. No access by kickoff means the kickoff moves." : "Secure tool access, then walk through the systems and the work done in them." },
  { key: "kickoff", label: "Kickoff", lead: INTERVIEWS_SHOWN ? "Scope, the Capacity Destination, the people in scope, and the owner's pledge." : "Dates, the guarantee, the scope and the Capacity Destination." },
  { key: "survey", label: "Survey", lead: "Each person's tasks, hours, energy and judgment, entered one at a time." },
  { key: "conversations", label: "Conversations", lead: "Thirty minutes each, starting from their best work." },
  { key: "build", label: "Build", lead: INTERVIEWS_SHOWN ? "The Capacity Map, the candidates, and the first win." : "The systems map, the candidates, and the first win." },
  { key: "readout", label: "Readout", lead: "The readout in the order it runs, then Publish, then the decision." },
] as const;

export type DiagnosticStep = (typeof ALL_STEPS)[number]["key"];

const INTERVIEW_STEPS: readonly DiagnosticStep[] = ["survey", "conversations"];

// The steps on the page: every one, less the interviews while hidden.
export const DIAGNOSTIC_STEPS = ALL_STEPS.filter((s) => INTERVIEWS_SHOWN || !INTERVIEW_STEPS.includes(s.key));

export function isStep(v: string | undefined): v is DiagnosticStep {
  return DIAGNOSTIC_STEPS.some((s) => s.key === v);
}

export function stepAfter(step: DiagnosticStep): DiagnosticStep | null {
  const i = DIAGNOSTIC_STEPS.findIndex((s) => s.key === step);
  return DIAGNOSTIC_STEPS[i + 1]?.key ?? null;
}

export function stepBefore(step: DiagnosticStep): DiagnosticStep | null {
  const i = DIAGNOSTIC_STEPS.findIndex((s) => s.key === step);
  return i > 0 ? DIAGNOSTIC_STEPS[i - 1].key : null;
}

const ORDER: DiagnosticStatus[] = ["preflight", "kickoff", "survey", "conversations", "build", "readout", "decided"];

// Moving forward never moves a diagnostic's status back.
export function statusAfterVisiting(current: DiagnosticStatus, step: DiagnosticStep): DiagnosticStatus {
  return ORDER.indexOf(step) > ORDER.indexOf(current) ? step : current;
}

// The step a diagnostic opens on: where it has got to. A decided one
// opens on its readout; one left on a hidden interview step opens on
// Build, the next step shown.
export function stepForStatus(status: DiagnosticStatus): DiagnosticStep {
  const shown = DIAGNOSTIC_STEPS.find((s) => s.key === status);
  if (shown) return shown.key;
  return status === "survey" || status === "conversations" ? "build" : "readout";
}
