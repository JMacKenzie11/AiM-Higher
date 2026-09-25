// What to show somebody while a tool runs.
//
// ---- WHY THIS EXISTS -------------------------------------------
//
// The coach route forwards text deltas and nothing else, so a model
// turn that produces only tool calls renders as a blank screen. On
// one measured conversation that window carried ~3,200 output
// tokens — most of a minute of generation — with nothing on screen,
// and then a 215 word answer arrived. The work was real; the
// silence was the problem.
//
// ---- WHY A MAP AND NOT THE TOOL NAME ---------------------------
//
// "get_role_description" is the name of a function. A person waiting
// for an answer about someone they manage should not be shown the
// internals, and a tool name is exactly that. An unknown name falls
// back to a neutral phrase rather than leaking the identifier.

const LABELS: Record<string, string> = {
  get_foundation: "Reading the company's foundation",
  list_functions: "Looking at the functional chart",
  get_role_description: "Reading the role description",
  get_meeting_debrief: "Reading the meeting summary",
  get_strengths_profile: "Checking strengths results",
  commitment_history: "Looking back through commitments",
  issue_casefiles: "Reading the issue history",
  planning_history: "Looking at past plans",
  scorecard_trajectory: "Checking the scorecard trend",
  search_classroom: "Searching the classroom",
  memory_lookup: "Recalling earlier conversations",
};

export function toolLabel(name: string): string {
  return LABELS[name] ?? "Gathering context";
}

// The names this map knows about, so a test can hold it against the
// tools the route actually registers.
export const LABELLED_TOOLS = Object.keys(LABELS);
