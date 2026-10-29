import { screenStates, stepFromScreens, taskScored } from "./screens";
import type { DiagnosticBundle } from "./types";
import type { DiagnosticStep } from "./steps";

// WHERE EACH STEP STANDS (0309; Jason, 2026-10-29). The one function
// the step tabs and the overview hub use: complete, in progress or not
// started. A step is complete when its required screens are done
// (screens.ts), so the tabs and the hub never disagree:
//
//   Pre-flight  access secured, a system, a task, and every task scored
//               (how often, data risk, build effort, needs approval,
//               agent type)
//   Kickoff     kickoff and readout dates, scope and the Capacity
//               Destination
//   Build       the first win measured, and the three rules
//   Readout     published and the decision recorded
// Anything entered for a step and short of that is in progress.

export type StepState = "complete" | "in_progress" | "not_started";

export { taskScored };

export function stepStates(b: Pick<DiagnosticBundle, "diagnostic" | "systems" | "links" | "tasks" | "firstWin">): Record<DiagnosticStep, StepState> {
  const states = screenStates(b);
  return {
    preflight: stepFromScreens("preflight", states),
    kickoff: stepFromScreens("kickoff", states),
    build: stepFromScreens("build", states),
    readout: stepFromScreens("readout", states),
    // Hidden steps (steps.ts) report nothing.
    survey: "not_started",
    conversations: "not_started",
  };
}

export const STEP_STATE_LABEL: Record<StepState, string> = {
  complete: "Done",
  in_progress: "In progress",
  not_started: "Not started",
};
