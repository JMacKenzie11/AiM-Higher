import type { DiagnosticStatus } from "./types";

// The engagement page's steps, in the order a Capacity Diagnostic
// runs. The step rides in the URL, as the weekly meeting's does
// (meeting/steps.ts). `lead` is the line under the page title.
export const DIAGNOSTIC_STEPS = [
  { key: "preflight", label: "Pre-flight", lead: "Secure tool access before kickoff. No access by kickoff means the kickoff moves." },
  { key: "kickoff", label: "Kickoff", lead: "Scope, the Capacity Destination, the people in scope, and the owner's pledge." },
  { key: "survey", label: "Survey", lead: "Each person's tasks, hours, energy and judgment, entered one at a time." },
  { key: "conversations", label: "Conversations", lead: "Thirty minutes each, starting from their best work." },
  { key: "build", label: "Build", lead: "The Capacity Map, the candidates, and the first win." },
  { key: "readout", label: "Readout", lead: "The readout in the order it runs, then Publish, then the decision." },
] as const;

export type DiagnosticStep = (typeof DIAGNOSTIC_STEPS)[number]["key"];

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
// opens on its readout.
export function stepForStatus(status: DiagnosticStatus): DiagnosticStep {
  return isStep(status) ? status : "readout";
}
