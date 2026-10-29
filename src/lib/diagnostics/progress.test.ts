import { describe, expect, it } from "vitest";
import { stepStates, taskScored } from "./progress";
import { readoutBundle } from "./readout.fixture";
import type { DiagnosticBundle, TaskRow } from "./types";

const scored = (t: TaskRow): TaskRow => ({ ...t, frequency: "weekly", data_risk: "low", build_effort: "half_day", agent_type: "reporting", needs_approval: false });

function blank(): DiagnosticBundle {
  const b = readoutBundle({
    tools_in_use: null,
    it_contact: null,
    access_secured: false,
    brief_sent: false,
    kickoff_at: null,
    readout_at: null,
    scope: null,
    capacity_destination: null,
    data_at_risk: null,
    guardrail_rules: null,
    roadmap: [],
    narrative: null,
    published_at: null,
    decision: "pending",
    midpoint_at: null,
    midpoint_note: null,
  }, null);
  return { ...b, tasks: [], systems: [], links: [] };
}

describe("taskScored", () => {
  it("needs how often, data risk, build effort, needs approval and agent type", () => {
    const t = readoutBundle().tasks[0];
    expect(taskScored(scored(t))).toBe(true);
    expect(taskScored({ ...scored(t), needs_approval: null })).toBe(false);
    expect(taskScored({ ...scored(t), agent_type: null })).toBe(false);
    // Build hours from before 0309 count as a build effort.
    expect(taskScored({ ...scored(t), build_effort: null, build_effort_hours: 3 })).toBe(true);
  });
});

describe("stepStates", () => {
  it("is not started for a new diagnostic", () => {
    expect(stepStates(blank())).toMatchObject({ preflight: "not_started", kickoff: "not_started", build: "not_started", readout: "not_started" });
  });

  it("moves Pre-flight to in progress on the first entry, and complete when access, a system and every task are scored", () => {
    const b = blank();
    b.diagnostic.it_contact = "Sam, sam@example.com";
    expect(stepStates(b).preflight).toBe("in_progress");
    const full = readoutBundle();
    const done: DiagnosticBundle = {
      ...full,
      diagnostic: { ...full.diagnostic, access_secured: true },
      systems: [{ id: "s1", diagnostic_id: full.diagnostic.id, name: "Outlook", kind: "email", holds: null, owner_name: null, notes: null, created_at: "2026-10-01" }],
      tasks: full.tasks.map(scored),
    };
    expect(stepStates(done).preflight).toBe("complete");
    expect(stepStates({ ...done, tasks: [...done.tasks.slice(1), { ...done.tasks[0], agent_type: null }] }).preflight).toBe("in_progress");
  });

  it("completes Kickoff with both dates, the scope and the destination", () => {
    const b = blank();
    b.diagnostic.owner_wish_list = "Chasing invoices";
    expect(stepStates(b).kickoff).toBe("in_progress");
    Object.assign(b.diagnostic, { kickoff_at: "2026-10-01", readout_at: "2026-10-22", scope: "Front office", capacity_destination: "Sales" });
    expect(stepStates(b).kickoff).toBe("complete");
  });

  it("completes Build with a measured first win and the rules, and Readout once published and decided", () => {
    const b = readoutBundle({ guardrail_rules: "A person reads every draft", published_at: "2026-10-22T12:00:00Z", decision: "sprint" });
    expect(stepStates(b)).toMatchObject({ build: "complete", readout: "complete" });
    expect(stepStates({ ...b, diagnostic: { ...b.diagnostic, decision: "pending" } }).readout).toBe("in_progress");
    expect(stepStates({ ...b, firstWin: { ...b.firstWin!, measured_week_ending: null } }).build).toBe("in_progress");
  });
});
