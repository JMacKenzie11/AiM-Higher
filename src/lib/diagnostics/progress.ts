import { taskEffort } from "./hours-back";
import { toTask, type DiagnosticBundle, type TaskRow } from "./types";
import type { DiagnosticStep } from "./steps";

// WHERE EACH STEP STANDS (0309; Jason, 2026-10-29). One function for
// the step tabs now and the overview hub later: complete, in progress
// or not started, from what has been entered. Pure.
//
//   Pre-flight  complete: access secured, a system, a task, and every
//               task scored (how often, data risk, build effort, needs
//               approval, agent type)
//   Kickoff     complete: kickoff and readout dates, scope and the
//               Capacity Destination
//   Build       complete: the first win measured, and the three rules
//   Readout     complete: published and the decision recorded
// Anything entered for a step and short of that is in progress.

export type StepState = "complete" | "in_progress" | "not_started";

export function taskScored(t: TaskRow): boolean {
  return Boolean(t.frequency && t.data_risk && taskEffort(toTask(t)) && t.agent_type && t.needs_approval != null);
}

const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : v != null && v !== false);

export function stepStates(b: Pick<DiagnosticBundle, "diagnostic" | "systems" | "links" | "tasks" | "firstWin">): Record<DiagnosticStep, StepState> {
  const d = b.diagnostic;
  const state = (complete: boolean, any: boolean): StepState => (complete ? "complete" : any ? "in_progress" : "not_started");
  return {
    preflight: state(
      d.access_secured && b.systems.length > 0 && b.tasks.length > 0 && b.tasks.every(taskScored),
      [d.tools_in_use, d.it_contact, d.access_secured, d.brief_sent, d.ai_tools, d.intake_channels, b.systems, b.tasks].some(has)
    ),
    kickoff: state(
      [d.kickoff_at, d.readout_at, d.scope, d.capacity_destination].every(has),
      [d.kickoff_at, d.readout_at, d.scope, d.capacity_destination, d.owner_wish_list, d.owner_away_breaks, d.owner_bottlenecks].some(has)
    ),
    build: state(
      Boolean(b.firstWin?.measured_week_ending) && has(d.guardrail_rules),
      [b.firstWin, d.data_at_risk, d.guardrail_rules, d.brand_voice, d.never_alone, d.midpoint_at, d.midpoint_note, d.agent_team].some(has)
    ),
    readout: state(Boolean(d.published_at) && d.decision !== "pending", [d.roadmap, d.narrative && Object.keys(d.narrative).length ? "x" : null, d.published_at].some(has)),
    // Hidden steps (steps.ts) report nothing.
    survey: "not_started",
    conversations: "not_started",
  } as Record<DiagnosticStep, StepState>;
}

export const STEP_STATE_LABEL: Record<StepState, string> = {
  complete: "Done",
  in_progress: "In progress",
  not_started: "Not started",
};
