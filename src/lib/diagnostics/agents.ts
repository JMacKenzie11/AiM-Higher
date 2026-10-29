import { isCandidate, taskHours, type DiagnosticTask } from "./hours-back";
import { AGENT_TYPES, NEVER_ALONE, TASK_FREQUENCIES, labelOf, type AgentCard, type AgentType, type NeverAlone } from "./types";

// THE RECOMMENDED AGENT TEAM (0309; Jason, 2026-10-29). The candidates
// grouped by the kind of agent that would do them, the groups with the
// most hours a week first, two to four of them (fewer when fewer kinds
// were chosen). "Not suitable for AI" and unscored tasks make no agent.
// Each card is a starting point the lead edits on Build; the edits are
// stored (diagnostics.agent_team) and the suggestion shows until then.
// Pure, so the Build step, the readout and its tests agree.

export const MAX_AGENTS = 4;

const ROLE: Record<Exclude<AgentType, "not_suitable">, string> = {
  inbox_triage: "Sorts what comes in, drafts replies, and routes the rest",
  reporting: "Pulls the numbers together and sends the regular reports",
  content: "Drafts the written pieces for a person to check",
  scheduling: "Books, moves and confirms appointments and jobs",
  ops_log: "Keeps the work log and the records up to date",
  customer_follow_up: "Follows up with customers on time, every time",
};

export type AgentGroup = { agentType: AgentType; hours: number; taskIds: string[]; titles: string[] };

// The candidate tasks by agent type, most hours a week first.
export function agentGroups(tasks: readonly DiagnosticTask[]): AgentGroup[] {
  const by = new Map<AgentType, AgentGroup>();
  for (const t of tasks) {
    const type = t.agentType as AgentType | null | undefined;
    if (!type || type === "not_suitable" || !isCandidate(t)) continue;
    const g = by.get(type) ?? { agentType: type, hours: 0, taskIds: [], titles: [] };
    g.hours += taskHours(t).hours;
    g.taskIds.push(t.id);
    const title = (t.canonicalTitle?.trim() || t.title).trim();
    if (!g.titles.some((x) => x.toLowerCase() === title.toLowerCase())) g.titles.push(title);
    by.set(type, g);
  }
  return [...by.values()].sort((a, b) => b.hours - a.hours || a.agentType.localeCompare(b.agentType));
}

// The limits every agent starts with: what the business said an agent
// must never do alone.
export function limitsText(neverAlone: readonly NeverAlone[], other: string | null): string {
  const items = [...neverAlone.map((n) => labelOf(NEVER_ALONE, n).toLowerCase()), ...(other?.trim() ? [other.trim()] : [])];
  return items.length ? `Never alone: ${items.join(", ")}` : "";
}

// The most common frequency among a group's tasks, for its routine.
function routineOf(tasks: readonly DiagnosticTask[], g: AgentGroup): string {
  const count = new Map<string, number>();
  for (const t of tasks) if (g.taskIds.includes(t.id) && t.frequency) count.set(t.frequency, (count.get(t.frequency) ?? 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return `${top ? `${labelOf(TASK_FREQUENCIES, top)}: ` : ""}${g.titles.join(", ")}`;
}

export function suggestAgentTeam(
  tasks: readonly DiagnosticTask[],
  context: { systemName: ReadonlyMap<string, string>; neverAlone: readonly NeverAlone[]; neverAloneOther: string | null }
): AgentCard[] {
  const limits = limitsText(context.neverAlone, context.neverAloneOther);
  return agentGroups(tasks)
    .slice(0, MAX_AGENTS)
    .map((g) => {
      const systems = [
        ...new Set(
          tasks
            .filter((t) => g.taskIds.includes(t.id))
            .flatMap((t) => [t.systemId, t.copiesFromSystemId, t.copiesToSystemId])
            .map((id) => (id ? context.systemName.get(id) : undefined))
            .filter((n): n is string => Boolean(n))
        ),
      ];
      const type = g.agentType as Exclude<AgentType, "not_suitable">;
      return {
        agentType: g.agentType,
        name: `${labelOf(AGENT_TYPES, type)} agent`,
        role: ROLE[type],
        routine: routineOf(tasks, g),
        connectors: systems.join(", "),
        limits,
      };
    });
}

// The team the readout and Build show: the lead's edits once there are
// any, the suggestion until then.
export function agentTeam(saved: AgentCard[] | null | undefined, suggested: AgentCard[]): AgentCard[] {
  return saved && saved.length ? saved : suggested;
}
