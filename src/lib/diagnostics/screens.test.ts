import { describe, expect, it } from "vitest";
import { SCREENS, nextAction, nextScreen, screenOf, screenStates, screensOf, skippedSoFar, stepFromScreens, stepPercent } from "./screens";
import { assembleReadout } from "./readout";
import { readoutBundle } from "./readout.fixture";
import type { DiagnosticBundle, TaskRow } from "./types";

const scored = (t: TaskRow): TaskRow => ({ ...t, frequency: "weekly", data_risk: "low", build_effort: "half_day", agent_type: "reporting", needs_approval: false });

function fresh(): DiagnosticBundle {
  const b = readoutBundle(
    {
      tools_in_use: null, it_contact: null, access_secured: false, brief_sent: false, kickoff_at: null, readout_at: null, scope: null,
      capacity_destination: null, data_at_risk: null, guardrail_rules: null, roadmap: [], narrative: null, published_at: null,
      decision: "pending", midpoint_at: null, midpoint_note: null, ai_tools: null,
    },
    null
  );
  return { ...b, tasks: [], systems: [], links: [] };
}

describe("the screens", () => {
  it("run six, three, four and four per step, in the mockup's order", () => {
    expect(screensOf("preflight").map((s) => s.key)).toEqual(["access", "systems", "links", "tasks", "score", "ai"]);
    expect(screensOf("kickoff").map((s) => s.key)).toEqual(["owner", "scope", "dates"]);
    expect(screensOf("build").map((s) => s.key)).toEqual(["candidates", "agents", "guardrails", "midpoint"]);
    expect(screensOf("readout").map((s) => s.key)).toEqual(["roadmap", "narrative", "preview", "publish"]);
    expect(SCREENS).toHaveLength(17);
  });

  it("finds a screen by step and key, and nothing for an unknown one", () => {
    expect(screenOf("build", "agents")?.title).toBe("Recommended agent team");
    expect(screenOf("build", "nope")).toBeNull();
    expect(screenOf("kickoff", undefined)).toBeNull();
  });
});

describe("screenStates and the next thing to do", () => {
  it("starts with nothing done, Continue on tool access, and Publish locked", () => {
    const b = fresh();
    const states = screenStates(b, { readout: assembleReadout(b, "2026-10-22") });
    expect(states["preflight.access"]).toBe("not_started");
    expect(states["readout.publish"]).toBe("locked");
    expect(nextScreen(states)?.key).toBe("access");
    expect(nextAction(nextScreen(states)!, b)).toBe("Secure tool access");
    expect(stepPercent("preflight", states)).toBe(0);
  });

  it("counts tasks still to score, and calls Score tasks started once one is scored", () => {
    const b = readoutBundle();
    const tasks = [scored(b.tasks[0]), ...b.tasks.slice(1)];
    const states = screenStates({ ...b, tasks });
    expect(states["preflight.score"]).toBe("started");
    expect(nextAction(screenOf("preflight", "score")!, { ...b, tasks })).toBe(`${tasks.length - 1} tasks need scoring`);
    expect(screenStates({ ...b, tasks: b.tasks.map(scored) })["preflight.score"]).toBe("done");
  });

  it("skips a locked screen when picking the next one", () => {
    const states = Object.fromEntries(SCREENS.map((s) => [`${s.step}.${s.key}`, "done"])) as Record<string, "done" | "locked">;
    states["readout.publish"] = "locked";
    expect(nextScreen(states)).toBeNull();
  });

  it("makes a step complete when its required screens are done, whatever the optional ones", () => {
    const states: Record<string, "done" | "not_started"> = { "kickoff.scope": "done", "kickoff.dates": "done", "kickoff.owner": "not_started" };
    expect(stepFromScreens("kickoff", states)).toBe("complete");
    expect(stepPercent("kickoff", states)).toBe(67);
    expect(stepFromScreens("kickoff", { "kickoff.owner": "done" })).toBe("in_progress");
  });

  it("counts the suggested agent team as the agents screen done", () => {
    expect(screenStates(fresh(), { agentCount: 2 })["build.agents"]).toBe("done");
    expect(screenStates(fresh(), { agentCount: 0 })["build.agents"]).toBe("not_started");
  });
});

describe("skippedSoFar", () => {
  it("notes an empty optional field only once a later screen in its step is under way", () => {
    const b = fresh();
    expect(skippedSoFar(b, screenStates(b))).toEqual([]);
    b.diagnostic.scope = "Front office";
    const notes = skippedSoFar(b, screenStates(b));
    expect(notes.map((n) => n.screen)).toEqual(["owner", "owner", "owner", "ai"]);
    expect(notes.every((n) => n.onReadout)).toBe(true);
  });

  it("notes the IT contact once systems are in, and unscored tasks once AI tools are", () => {
    const b = readoutBundle({ it_contact: null, ai_tools: "ChatGPT" });
    const texts = skippedSoFar(b, screenStates(b)).map((n) => n.text);
    expect(texts).toContain("You skipped the IT or admin contact.");
    expect(texts).toContain(`${b.tasks.length} tasks aren't scored yet.`);
  });
});
