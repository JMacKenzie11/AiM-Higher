import { describe, it, expect, beforeEach, vi } from "vitest";

// Which sessions Aimee may offer: those with an "Offer this when" line
// that this person could start here. Never one the button would then
// refuse, never one without a line, never from the code-only fallback.

const mocks = vi.hoisted(() => ({
  agents: [] as Array<{ id: string; title: string; agentRowId: string | null; archived: boolean }>,
  lines: new Map<string, string>(),
  refused: new Set<string>(),
}));

vi.mock("@/lib/practices/resolve", () => ({ listAgents: async () => mocks.agents }));
vi.mock("@/lib/practices/offer-when", () => ({ loadOfferWhen: async () => mocks.lines }));
vi.mock("@/lib/practices/gate", () => ({
  practiceGate: async (agent: { id: string }) =>
    mocks.refused.has(agent.id) ? { ok: false, message: "no" } : { ok: true },
}));

import { offerableSessions, sessionOfferPromptBlock, handoffBlock, HANDOFF_OPENER_PROMPT } from "./session-offers";

const args = {
  db: {} as never,
  profile: { id: "u1", role: "team_member", company_id: "co1", guide_company_ids: [] } as never,
  companyId: "co1",
};

beforeEach(() => {
  mocks.agents = [
    { id: "prepare-a-hard-conversation", title: "Prepare a hard conversation", agentRowId: "r1", archived: false },
    { id: "functional-chart-builder", title: "Functional Chart Builder", agentRowId: "r2", archived: false },
    { id: "guide-meeting-debrief", title: "Debrief a meeting", agentRowId: "r3", archived: false },
  ];
  mocks.lines = new Map([
    ["r1", "Someone needs to raise a problem."],
    ["r2", "A leader wants a chart."],
  ]);
  mocks.refused = new Set();
});

describe("offerableSessions", () => {
  it("lists the sessions with a line, with their names", async () => {
    expect(await offerableSessions(args)).toEqual([
      { id: "prepare-a-hard-conversation", title: "Prepare a hard conversation", offerWhen: "Someone needs to raise a problem." },
      { id: "functional-chart-builder", title: "Functional Chart Builder", offerWhen: "A leader wants a chart." },
    ]);
  });

  it("leaves out a session this person could not start", async () => {
    mocks.refused = new Set(["functional-chart-builder"]);
    expect((await offerableSessions(args)).map((s) => s.id)).toEqual(["prepare-a-hard-conversation"]);
  });

  it("offers nothing from the code-only fallback, which has no rows and so no lines", async () => {
    mocks.agents = mocks.agents.map((a) => ({ ...a, agentRowId: null }));
    expect(await offerableSessions(args)).toEqual([]);
  });
});

describe("the prompt", () => {
  it("is empty when there is nothing to offer", () => {
    expect(sessionOfferPromptBlock([])).toBe("");
  });

  it("names each session by id with its line, and how to write the block", () => {
    const block = sessionOfferPromptBlock([
      { id: "prepare-a-hard-conversation", title: "Prepare a hard conversation", offerWhen: "Someone needs to raise a problem." },
    ]);
    expect(block).toContain("- Prepare a hard conversation (id for the block: prepare-a-hard-conversation). Offer it when: Someone needs to raise a problem.");
    expect(block).toContain("```session_offer");
    expect(block).toContain('Not now arrives as their message "Not now."');
  });

  // Jason, 2026-10-05: three replies about a reactive person and no
  // offer. Aimee's principles allow one question a reply, and every
  // reply already ended with a coaching question; and "not before you
  // understand" kept her exploring. The offer is that reply's question,
  // and it comes by the second reply.
  it("makes the offer the reply's one question, by the second reply", () => {
    const block = sessionOfferPromptBlock([{ id: "a", title: "A", offerWhen: "b" }]);
    expect(block).toContain("the offer is this reply's one question, in place of any other");
    expect(block).toContain("at the latest in your second reply about it");
    expect(block).not.toContain("not before you understand");
    expect(block).toContain('Do not use the words "guided session", "matches" or "fits" anywhere in the reply');
    expect(block).toContain("If their next message does not take up the offer, that is a no too");
    expect(block).toContain("never write it anywhere else");
  });

  it("is written without dashes, like everything Aimee reads as her own voice", () => {
    const text = sessionOfferPromptBlock([{ id: "a", title: "A", offerWhen: "b" }]) + handoffBlock("s") + HANDOFF_OPENER_PROMPT;
    expect(text).not.toMatch(/[—–]/);
  });

  it("never lets the session call it a handoff or a summary to the person", () => {
    expect(handoffBlock("s")).toContain("never as a handoff or a summary");
    expect(HANDOFF_OPENER_PROMPT).toContain("without calling it a handoff or a summary");
  });

  it("carries the accepted summary into the session", () => {
    expect(handoffBlock("Sam missed the report.")).toContain("Sam missed the report.");
  });
});
