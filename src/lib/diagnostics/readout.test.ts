import { describe, it, expect } from "vitest";
import { assembleReadout, hoursBackSentence, publishBlocker, readoutFigures, readoutMarkdown, splitList } from "./readout";
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
