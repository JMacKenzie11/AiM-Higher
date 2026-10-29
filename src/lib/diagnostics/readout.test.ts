import { describe, it, expect } from "vitest";
import { assembleReadout, hoursBackSentence, publishBlocker, readoutFigures, readoutMarkdown, showsPrivacyLine, splitList } from "./readout";
import { readoutBundle } from "./readout.fixture";

const TODAY = "2026-10-22";

describe("the readout, assembled", () => {
  const r = assembleReadout(readoutBundle(), TODAY);

  it("uses only approved lines, the first three approved, named only when the lead named them", () => {
    expect(r.quotes).toEqual([
      { text: "I spend my mornings retyping the same quote.", name: null },
      { text: "If the first draft was there, I'd check it and send it.", name: "Lee Chan" },
      { text: "The inbox decides my day.", name: null },
    ]);
  });

  it("takes the first win's figures from hours-back.ts", () => {
    expect(r.firstWin).toMatchObject({ title: "Quote drafts from email", pattern: "Quote first draft", serves: "Quoting", role: "Estimator", measured: 6 });
    expect(r.hoursBack.measured).toBe(6);
    expect(r.hoursBack.recoveryRate).toBeCloseTo(0.6);
    // The other six candidates' 27 hours at the first win's rate.
    expect(r.hoursBack.projected).toBeCloseTo(16.2);
    expect(r.hoursBack.guaranteeMet).toBe(true);
  });

  it("sums the hours toward the destination by role, never by name", () => {
    expect(r.destination.roles).toEqual([{ role: "Estimator", hours: 5, wishes: ["Walk the shop floor with new customers", "Follow up on open quotes"] }]);
    expect(r.destination.assignedHours).toBe(5);
    expect(JSON.stringify(r.destination)).not.toMatch(/Dana|Lee|Sam|Kim/);
  });

  it("lists the next wins by score, leaving out the first win's work and slow builds, with the roles they help", () => {
    expect(r.nextWins.map((w) => w.title)).toEqual(["Order entry", "Supplier follow-up"]);
    expect(r.nextWins[0]).toMatchObject({ hours: 12, people: 2, helps: ["Estimator", "Office manager"] });
    expect(r.nextWins[1].helps).toEqual(["Team member"]);
  });

  it("splits the tools and the rules into lists", () => {
    expect(r.guardrails.tools).toEqual(["Outlook", "Excel", "QuickBooks"]);
    expect(r.guardrails.rules).toEqual(["A person reads every draft before it goes out", "No customer data in a personal account", "Name one owner for each tool"]);
    expect(splitList("- one\n* two\n\n3) three")).toEqual(["one", "two", "three"]);
  });

  it("names nobody outside an approved, named quote", () => {
    const { quotes, ...rest } = r;
    expect(JSON.stringify(rest)).not.toMatch(/Dana Ruiz|Lee Chan|Sam Ortiz|Kim Park/);
    expect(quotes.filter((q) => q.name)).toHaveLength(1);
  });
});

describe("publishing", () => {
  it("needs the first win's measured week", () => {
    expect(publishBlocker(assembleReadout(readoutBundle(), TODAY))).toBeNull();
    expect(publishBlocker(assembleReadout(readoutBundle({}, { measured_week_ending: null }), TODAY))).toMatch(/measured week/);
    expect(publishBlocker(assembleReadout(readoutBundle({}, null), TODAY))).toMatch(/first win/);
  });
});

describe("Hours Back, kept apart", () => {
  it("says measured and projected separately and never sums them", () => {
    const text = hoursBackSentence(assembleReadout(readoutBundle(), TODAY).hoursBack);
    expect(text).toContain("6 hours a week, measured");
    expect(text).toContain("16.2 more a week projected");
    expect(text).not.toContain("22.2");
  });
});

describe("the figures the narrative may use", () => {
  it("carries every printed number, as printed", () => {
    const figures = readoutFigures(assembleReadout(readoutBundle(), TODAY));
    for (const f of ["6", "16.2", "60", "25", "10", "24", "5", "12", "3"]) expect(figures).toContain(f);
  });
});

describe("the Markdown download", () => {
  it("holds the destination, the next wins and the roadmap, and no names", () => {
    const md = readoutMarkdown(assembleReadout(readoutBundle(), TODAY));
    expect(md).toContain("## The Capacity Destination");
    expect(md).toContain("Answer every quote request the same day.");
    expect(md).toContain("- Estimator: 5 hours a week");
    expect(md).toContain("1. Order entry: 12 hours a week");
    expect(md).toContain("1. Order entry from email (week 3), champion: Estimator");
    expect(md).not.toMatch(/Dana|Lee Chan|—/);
  });
});

describe("a readout with the interviews hidden (0305)", () => {
  it("takes a role from the task when no person is attached, and lists the AI tools", () => {
    const b = readoutBundle({ ai_tools: "ChatGPT, Copilot" });
    b.tasks = b.tasks.map((t) => (t.canonical_title === "Quoting" ? { ...t, participant_id: null, energy: null, judgment: null, source: "lead" as const, role_title: "Quoting desk" } : t));
    const r = assembleReadout(b, TODAY);
    expect(r.firstWin?.role).toBe("Quoting desk");
    expect(r.systems?.aiTools).toEqual(["ChatGPT", "Copilot"]);
    expect(readoutFigures(r)).toContain("2");
    expect(showsPrivacyLine(r)).toBe(false);
  });

  it("keeps the privacy line on a readout that runs the interviews", () => {
    expect(showsPrivacyLine({ sections: undefined })).toBe(true);
  });
});

describe("the owner's week, the voice and limits, and the agent team (0309)", () => {
  const r = assembleReadout(
    readoutBundle({
      owner_wish_list: "Chasing late invoices",
      owner_away_breaks: null,
      owner_bottlenecks: "Approving every quote over 5,000",
      brand_voice: "Friendly and direct",
      never_alone: ["send_messages"],
      never_alone_other: null,
      agent_team: [{ agentType: "reporting", name: "Numbers agent", role: "Sends the Monday report", routine: "Weekly", connectors: "Acumatica", limits: "" }],
    }),
    TODAY
  );

  it("carries the owner's answered questions, the voice, the limits and the team", () => {
    expect(r.ownerWeek).toEqual({ wishList: "Chasing late invoices", awayBreaks: null, bottlenecks: "Approving every quote over 5,000" });
    expect(r.guardrails).toMatchObject({ voice: "Friendly and direct", neverAlone: "Never alone: send messages" });
    expect(r.agentTeam?.map((a) => a.name)).toEqual(["Numbers agent"]);
  });

  it("lets the narrative use the numbers in the owner's words", () => {
    expect(readoutFigures(r)).toContain("5000");
  });

  it("puts the owner's week and the agent team in the Markdown", () => {
    const md = readoutMarkdown(r);
    expect(md).toContain("### The owner's week");
    expect(md).toContain("- Where does work wait on you to decide or approve? Approving every quote over 5,000");
    expect(md).not.toContain("What breaks or waits");
    expect(md).toContain("## Recommended agent team");
    expect(md).toContain("### Numbers agent");
  });

  it("leaves the owner's week out when nothing was answered", () => {
    expect(assembleReadout(readoutBundle(), TODAY).ownerWeek).toBeUndefined();
  });
});
