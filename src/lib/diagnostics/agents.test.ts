import { describe, expect, it } from "vitest";
import { agentGroups, agentTeam, limitsText, suggestAgentTeam, MAX_AGENTS } from "./agents";
import type { DiagnosticTask } from "./hours-back";

let n = 0;
const task = (title: string, hours: number, extra: Partial<DiagnosticTask> = {}): DiagnosticTask => ({
  id: `t${++n}`,
  participantId: null,
  roleTitle: "Office",
  title,
  canonicalTitle: null,
  hoursPerWeek: hours,
  energy: null,
  judgment: null,
  volumeUnitsPerWeek: null,
  minutesPerUnit: null,
  dataRisk: "low",
  buildEffortHours: null,
  candidateOverride: null,
  ...extra,
});

const tasks = [
  task("Shared inbox", 6, { agentType: "inbox_triage", frequency: "daily", systemId: "s1" }),
  task("Supplier emails", 3, { agentType: "inbox_triage", frequency: "daily", systemId: "s1" }),
  task("Weekly sales report", 4, { agentType: "reporting", frequency: "weekly", systemId: "s2" }),
  task("Quote follow-ups", 5, { agentType: "customer_follow_up", frequency: "weekly" }),
  task("Booking installs", 2, { agentType: "scheduling" }),
  task("Job notes", 1, { agentType: "ops_log" }),
  task("Pricing exceptions", 8, { agentType: "not_suitable" }),
  task("Unscored", 9),
  task("Left out", 7, { agentType: "reporting", candidateOverride: false }),
];

describe("agentGroups", () => {
  it("groups candidates by agent type, most hours first, leaving out not suitable, unscored and left-out tasks", () => {
    expect(agentGroups(tasks).map((g) => [g.agentType, g.hours])).toEqual([
      ["inbox_triage", 9],
      ["customer_follow_up", 5],
      ["reporting", 4],
      ["scheduling", 2],
      ["ops_log", 1],
    ]);
  });
});

describe("suggestAgentTeam", () => {
  const team = suggestAgentTeam(tasks, {
    systemName: new Map([["s1", "Outlook"], ["s2", "Acumatica"]]),
    neverAlone: ["send_messages", "quote_pricing"],
    neverAloneOther: "Change a customer's account",
  });

  it("suggests up to four agents, the biggest first", () => {
    expect(team).toHaveLength(MAX_AGENTS);
    expect(team.map((a) => a.name)).toEqual(["Inbox triage agent", "Customer follow-up agent", "Reporting agent", "Scheduling agent"]);
  });

  it("fills the routine from the tasks and their frequency, the connectors from their systems, and the limits from never alone", () => {
    expect(team[0]).toMatchObject({
      agentType: "inbox_triage",
      routine: "Daily: Shared inbox, Supplier emails",
      connectors: "Outlook",
      limits: "Never alone: send messages, quote pricing, Change a customer's account",
    });
    expect(team[2].connectors).toBe("Acumatica");
  });

  it("suggests nothing when no task has an agent type", () => {
    expect(suggestAgentTeam([task("A", 3)], { systemName: new Map(), neverAlone: [], neverAloneOther: null })).toEqual([]);
  });
});

describe("the team shown", () => {
  it("is the lead's edits once there are any, the suggestion until then", () => {
    const suggested = [{ agentType: null, name: "S", role: "", routine: "", connectors: "", limits: "" }];
    const edited = [{ agentType: null, name: "E", role: "", routine: "", connectors: "", limits: "" }];
    expect(agentTeam(null, suggested)).toBe(suggested);
    expect(agentTeam([], suggested)).toBe(suggested);
    expect(agentTeam(edited, suggested)).toBe(edited);
  });

  it("writes no limits line when nothing was ticked", () => {
    expect(limitsText([], null)).toBe("");
  });
});
