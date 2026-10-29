import { publishBlocker, type ReadoutData } from "./readout";
import { taskEffort } from "./hours-back";
import { toTask, type DiagnosticBundle, type TaskRow } from "./types";
import type { DiagnosticStep } from "./steps";

// THE GUIDED SCREENS (Jason, 2026-10-29: the hybrid wizard, approved
// mockup). Each step is a short sequence of screens, one job each, any
// of them open at any time. This file says what the screens are, where
// each stands, what to do next, and what was skipped. Pure, so the
// overview hub, each screen's progress bar and the step tabs agree
// (progress.ts derives the step states from here).
//
// A screen is done, started or not started. A required screen is what
// the step needs to be complete; the rest are worth doing and never
// hold anything up. Nothing is locked but Publish, which needs the
// first win's measured week (publishBlocker).

// A task is scored when it has all five: how often, data risk, build
// effort, needs approval and agent type.
export function taskScored(t: TaskRow): boolean {
  return Boolean(t.frequency && t.data_risk && taskEffort(toTask(t)) && t.agent_type && t.needs_approval != null);
}

export type ScreenState = "done" | "started" | "not_started" | "locked";

export type ScreenDef = {
  step: Exclude<DiagnosticStep, "survey" | "conversations">;
  key: string;
  title: string;
  heading: string;
  why: string;
  required: boolean;
};

export const SCREENS: readonly ScreenDef[] = [
  { step: "preflight", key: "access", title: "Tool access and contact", heading: "Tool access and the IT contact", why: "Builds need access on day one. No access by kickoff means the kickoff moves.", required: true },
  { step: "preflight", key: "systems", title: "Systems", heading: "The systems they work in", why: "Every week's work lives somewhere. These are the boxes on the systems map.", required: true },
  { step: "preflight", key: "links", title: "How information moves", heading: "How information moves", why: "Information carried by hand between systems is where the hours hide.", required: false },
  { step: "preflight", key: "tasks", title: "Tasks", heading: "The work done in them", why: "Each recurring task, who does it, where, and its hours a week.", required: true },
  { step: "preflight", key: "score", title: "Score tasks", heading: "Score the tasks", why: "The scores rank the candidates and suggest the agent team. Skip any you're unsure of.", required: true },
  { step: "preflight", key: "ai", title: "AI tools", heading: "AI tools and what's written down", why: "What the team already uses, and what an agent could learn from.", required: false },
  { step: "kickoff", key: "owner", title: "The owner's week", heading: "The owner's week", why: "Where the owner's own time goes. It shows on the readout under The Capacity Destination.", required: false },
  { step: "kickoff", key: "scope", title: "Scope and Capacity Destination", heading: "Scope and the Capacity Destination", why: "What's in scope, and the one priority the freed hours go to.", required: true },
  { step: "kickoff", key: "dates", title: "Dates and guarantee", heading: "Dates and the guarantee", why: "The kickoff and readout dates, and the hours the first win promises.", required: true },
  { step: "build", key: "candidates", title: "Candidates and first win", heading: "Candidates and the first win", why: "The highest-scoring candidates, and the first win measured over its first full week.", required: true },
  { step: "build", key: "agents", title: "Recommended agent team", heading: "Recommended agent team", why: "The agents the candidate work adds up to. Edit them to fit the business.", required: false },
  { step: "build", key: "guardrails", title: "Guardrails", heading: "Guardrails: voice, limits and rules", why: "How agents sound, what they never do alone, and three rules to put in place now.", required: true },
  { step: "build", key: "midpoint", title: "Midpoint check", heading: "Midpoint check", why: "Share the early measured number with the owner and confirm the readout.", required: false },
  { step: "readout", key: "roadmap", title: "Roadmap", heading: "The 90-day roadmap", why: "Three next wins, the week each lands, and who to train.", required: false },
  { step: "readout", key: "narrative", title: "Narrative", heading: "The narrative", why: "One short paragraph for each section, in plain words around the figures.", required: false },
  { step: "readout", key: "preview", title: "Preview", heading: "Preview the readout", why: "Read it as the owner will before you publish.", required: false },
  { step: "readout", key: "publish", title: "Publish and decide", heading: "Publish and decide", why: "Publishing fixes the readout. Then record what the owner decided.", required: true },
] as const;

export const screensOf = (step: string) => SCREENS.filter((s) => s.step === step);
export const screenOf = (step: string, key: string | null | undefined) => SCREENS.find((s) => s.step === step && s.key === key) ?? null;

type Bundle = Pick<DiagnosticBundle, "diagnostic" | "systems" | "links" | "tasks" | "firstWin">;

const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : v != null && v !== false);
const st = (done: boolean, started: boolean): ScreenState => (done ? "done" : started ? "started" : "not_started");

// Where every screen stands. agentCount is the team shown (the lead's
// edits, else the suggestion); readout, when given, decides the lock.
export function screenStates(b: Bundle, extra: { agentCount?: number; readout?: ReadoutData } = {}): Record<string, ScreenState> {
  const d = b.diagnostic;
  const kb = d.knowledge_base ?? {};
  const scored = b.tasks.filter(taskScored).length;
  const out: Record<string, ScreenState> = {
    "preflight.access": st(d.access_secured, [d.tools_in_use, d.it_contact, d.brief_sent].some(filled)),
    "preflight.systems": st(b.systems.length > 0, false),
    "preflight.links": st(b.links.length > 0, filled(d.intake_channels) || filled(d.intake_other)),
    "preflight.tasks": st(b.tasks.length > 0, false),
    "preflight.score": st(b.tasks.length > 0 && scored === b.tasks.length, scored > 0),
    "preflight.ai": st(filled(d.ai_tools), Object.values(kb).some(filled)),
    "kickoff.owner": st([d.owner_wish_list, d.owner_away_breaks, d.owner_bottlenecks].every(filled), [d.owner_wish_list, d.owner_away_breaks, d.owner_bottlenecks].some(filled)),
    "kickoff.scope": st(filled(d.scope) && filled(d.capacity_destination), filled(d.scope) || filled(d.capacity_destination)),
    "kickoff.dates": st(filled(d.kickoff_at) && filled(d.readout_at), filled(d.kickoff_at) || filled(d.readout_at)),
    "build.candidates": st(Boolean(b.firstWin?.measured_week_ending), Boolean(b.firstWin)),
    "build.agents": st((extra.agentCount ?? (d.agent_team?.length ?? 0)) > 0, false),
    "build.guardrails": st(filled(d.guardrail_rules), [d.brand_voice, d.never_alone, d.never_alone_other, d.data_at_risk].some(filled)),
    "build.midpoint": st(filled(d.midpoint_at), filled(d.midpoint_note)),
    "readout.roadmap": st(filled(d.roadmap), false),
    "readout.narrative": st(Boolean(d.narrative && Object.keys(d.narrative).length), false),
    "readout.preview": st(Boolean(d.published_at), false),
    "readout.publish": st(Boolean(d.published_at) && d.decision !== "pending", Boolean(d.published_at)),
  };
  if (!d.published_at && extra.readout && publishBlocker(extra.readout)) out["readout.publish"] = "locked";
  return out;
}

export const stateOf = (states: Record<string, ScreenState>, s: Pick<ScreenDef, "step" | "key">) => states[`${s.step}.${s.key}`] ?? "not_started";

// A step's place: complete when its required screens are done, in
// progress once any screen is started or done.
export function stepFromScreens(step: string, states: Record<string, ScreenState>): "complete" | "in_progress" | "not_started" {
  const screens = screensOf(step);
  if (screens.filter((s) => s.required).every((s) => stateOf(states, s) === "done")) return "complete";
  return screens.some((s) => ["done", "started"].includes(stateOf(states, s))) ? "in_progress" : "not_started";
}

// Share of a step's screens done, as a whole percentage.
export function stepPercent(step: string, states: Record<string, ScreenState>): number {
  const screens = screensOf(step);
  return Math.round((screens.filter((s) => stateOf(states, s) === "done").length / screens.length) * 100);
}

// The first screen not done, in order, skipping a locked one.
export function nextScreen(states: Record<string, ScreenState>, step?: string): ScreenDef | null {
  return (step ? screensOf(step) : SCREENS).find((s) => !["done", "locked"].includes(stateOf(states, s))) ?? null;
}

// What the next screen asks for, in a few words.
export function nextAction(s: ScreenDef, b: Bundle): string {
  const unscored = b.tasks.filter((t) => !taskScored(t)).length;
  switch (`${s.step}.${s.key}`) {
    case "preflight.access":
      return b.diagnostic.access_secured ? "Add the IT contact" : "Secure tool access";
    case "preflight.systems":
      return "Add the systems they work in";
    case "preflight.links":
      return "Add how information moves";
    case "preflight.tasks":
      return "Add the recurring tasks";
    case "preflight.score":
      return unscored === 1 ? "1 task needs scoring" : `${unscored} tasks need scoring`;
    case "preflight.ai":
      return "Add the AI tools they use";
    case "kickoff.owner":
      return "Ask the owner about their week";
    case "kickoff.scope":
      return "Set the scope and the Capacity Destination";
    case "kickoff.dates":
      return "Set the kickoff and readout dates";
    case "build.candidates":
      return b.firstWin ? "Measure the first win's first full week" : "Choose the first win";
    case "build.agents":
      return "Score agent types to suggest a team";
    case "build.guardrails":
      return "Write the three rules";
    case "build.midpoint":
      return "Record the midpoint check";
    case "readout.roadmap":
      return "Set the 90-day roadmap";
    case "readout.narrative":
      return "Write the narrative";
    case "readout.preview":
      return "Read the readout through";
    default:
      return "Publish the readout and record the decision";
  }
}

export type Skipped = { text: string; step: string; screen: string; onReadout: boolean };

// Optional things left empty on screens the lead has already been past
// (a later screen in the same step is started or done), so a note about
// them is a reminder, never a block.
export function skippedSoFar(b: Bundle, states: Record<string, ScreenState>): Skipped[] {
  const d = b.diagnostic;
  const past = (step: string, key: string) => {
    const screens = screensOf(step);
    const i = screens.findIndex((s) => s.key === key);
    return screens.slice(i + 1).some((s) => ["done", "started"].includes(stateOf(states, s)));
  };
  const out: Skipped[] = [];
  const add = (cond: boolean, text: string, step: string, screen: string, onReadout = false) => {
    if (cond && past(step, screen)) out.push({ text, step, screen, onReadout });
  };
  add(!d.it_contact?.trim(), "You skipped the IT or admin contact.", "preflight", "access");
  add(b.links.length === 0, "You skipped how information moves between systems.", "preflight", "links", true);
  const unscored = b.tasks.filter((t) => !taskScored(t)).length;
  add(unscored > 0, unscored === 1 ? "1 task isn't scored yet." : `${unscored} tasks aren't scored yet.`, "preflight", "score");
  add(!d.owner_wish_list?.trim(), "You skipped what the owner wishes they didn't do every week.", "kickoff", "owner", true);
  add(!d.owner_away_breaks?.trim(), "You skipped what breaks when the owner is away.", "kickoff", "owner", true);
  add(!d.owner_bottlenecks?.trim(), "You skipped where work waits on the owner.", "kickoff", "owner", true);
  add(!d.brand_voice?.trim() && stateOf(states, { step: "build", key: "guardrails" }) !== "not_started", "You skipped how the business sounds.", "build", "guardrails", true);
  if (!d.ai_tools?.trim() && ["started", "done"].includes(stateOf(states, { step: "kickoff", key: "scope" }))) {
    out.push({ text: "You skipped the AI tools the team uses.", step: "preflight", screen: "ai", onReadout: true });
  }
  return out;
}

export const screenHref = (diagnosticId: string, s: Pick<ScreenDef, "step" | "key">) => `/diagnostics/${diagnosticId}?step=${s.step}&screen=${s.key}`;
