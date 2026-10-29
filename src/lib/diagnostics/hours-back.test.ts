import { describe, it, expect } from "vitest";
import {
  candidateGroups,
  capacityMap,
  guaranteeMet,
  hoursChecked,
  isCandidate,
  measuredHoursBack,
  projectedHoursBack,
  recoveryRate,
  summarize,
  taskHours,
  topNextWins,
  formatHours,
  effortFromHours,
  SCORE_WEIGHTS,
  type DiagnosticTask,
  type DiagnosticWin,
} from "./hours-back";

// A plausible 10-person front office at a manufacturer: quoting,
// order entry, shipping reports and the shared inbox, with the work
// people are good at mixed in.
let n = 0;
function task(p: string, title: string, hours: number, energy: number, judgment: number, extra: Partial<DiagnosticTask> = {}): DiagnosticTask {
  n += 1;
  return {
    id: `t${n}`,
    participantId: p,
    title,
    canonicalTitle: null,
    hoursPerWeek: hours,
    energy,
    judgment,
    volumeUnitsPerWeek: null,
    minutesPerUnit: null,
    dataRisk: "low",
    buildEffortHours: 3,
    candidateOverride: null,
    ...extra,
  };
}

const office: DiagnosticTask[] = [
  task("p1", "Quotes", 8, 1, 2, { canonicalTitle: "Quoting", volumeUnitsPerWeek: 24, minutesPerUnit: 25 }),
  task("p1", "Customer calls", 6, 5, 4),
  task("p2", "quoting", 6, 2, 2, { canonicalTitle: "Quoting" }),
  task("p2", "Order entry", 5, 1, 1, { canonicalTitle: "Order entry" }),
  task("p3", "Entering orders", 7, 2, 1, { canonicalTitle: "Order entry" }),
  task("p4", "Shipping report", 4, 1, 1, { dataRisk: "high" }),
  task("p5", "Shared inbox", 6, 2, 2, { buildEffortHours: 8 }),
  task("p6", "Supplier follow-up", 3, 2, 2, { dataRisk: null }),
  task("p7", "Production planning", 10, 4, 5),
  task("p8", "Meeting notes", 2, 2, 1),
  task("p9", "Estimating", 9, 3, 5),
  task("p10", "Invoicing", 4, 1, 3),
];

const quoteTask = office[0];

describe("hours on a task", () => {
  it("uses the volume check when it is filled, and says so", () => {
    expect(hoursChecked(quoteTask)).toBe(10);
    expect(taskHours(quoteTask)).toEqual({ hours: 10, checked: true });
  });

  it("falls back to the reported hours otherwise", () => {
    expect(hoursChecked(office[2])).toBeNull();
    expect(taskHours(office[2])).toEqual({ hours: 6, checked: false });
  });
});

describe("candidates", () => {
  it("are draining and routine", () => {
    expect(isCandidate(office[0])).toBe(true);
    expect(isCandidate(office[1])).toBe(false);
    // Draining but needs judgment.
    expect(isCandidate(office[11])).toBe(false);
  });

  it("follow the lead's override either way", () => {
    expect(isCandidate({ ...office[11], candidateOverride: true })).toBe(true);
    expect(isCandidate({ ...office[0], candidateOverride: false })).toBe(false);
  });
});

describe("candidate score", () => {
  it("rolls tasks up by canonical title and scores hours up, data risk and build effort down", () => {
    const groups = candidateGroups(office);
    const quoting = groups.find((g) => g.key === "quoting")!;
    // 10 checked hours + 6 reported, low risk, 3 build hours (half a day).
    expect(quoting.breakdown).toEqual({ hours: 16 * SCORE_WEIGHTS.perHour, dataRisk: 0, buildEffort: 0 });
    expect(quoting.score).toBe(160);
    expect(quoting.buildEffort).toBe("half_day");
    expect(quoting.hours).toBe(16);
    expect(quoting.checkedHours).toBe(10);
    expect(quoting.people).toBe(2);
    expect(quoting.taskIds).toHaveLength(2);
    expect(groups[0].key).toBe("quoting");
  });

  it("weights data risk and build effort down, and counts an unscored one at its unset weight", () => {
    const groups = candidateGroups(office);
    const shipping = groups.find((g) => g.key === "shipping report")!;
    const inbox = groups.find((g) => g.key === "shared inbox")!;
    const supplier = groups.find((g) => g.key === "supplier follow-up")!;
    expect(shipping).toMatchObject({ dataRisk: "high", score: 40 + SCORE_WEIGHTS.dataRisk.high, quickWin: false });
    // 8 build hours read as one to two days.
    expect(inbox).toMatchObject({ buildEffort: "one_two_days", score: 60 + SCORE_WEIGHTS.buildEffort.one_two_days, quickWin: false });
    expect(supplier).toMatchObject({ dataRisk: null, score: 30 + SCORE_WEIGHTS.dataRisk.unset, quickWin: false });
    // Sorted by score, highest first.
    expect(groups.map((g) => g.score)).toEqual([...groups.map((g) => g.score)].sort((a, b) => b - a));
  });

  it("prefers the three steps to build hours, and turns hours into steps at 4 and 16", () => {
    expect(effortFromHours(4)).toBe("half_day");
    expect(effortFromHours(16)).toBe("one_two_days");
    expect(effortFromHours(17)).toBe("more");
    expect(effortFromHours(null)).toBeNull();
    const g = candidateGroups([task("p1", "Reports", 5, 1, 1, { buildEffortHours: 2, buildEffort: "more" })])[0];
    expect(g).toMatchObject({ buildEffort: "more", quickWin: false });
  });
});

const measuredWin: DiagnosticWin = {
  taskId: quoteTask.id,
  baselineMinutesPerUnit: 25,
  afterMinutesPerUnit: 10,
  unitsPerWeek: 24,
  measuredWeekEnding: "2026-11-06",
};

describe("hours back", () => {
  it("measures the first win from its measured week", () => {
    expect(measuredHoursBack(measuredWin)).toBe(6);
  });

  it("is undefined until the week is entered", () => {
    expect(measuredHoursBack({ ...measuredWin, measuredWeekEnding: null })).toBeNull();
    expect(measuredHoursBack({ ...measuredWin, afterMinutesPerUnit: null })).toBeNull();
    expect(measuredHoursBack(null)).toBeNull();
  });

  it("takes the recovery rate from the first win's task hours before the build", () => {
    expect(recoveryRate(measuredWin, office)).toBeCloseTo(0.6);
  });

  it("projects over the remaining candidates at that rate, apart from the measured figure", () => {
    const remaining = office
      .filter((t) => t.id !== quoteTask.id && isCandidate(t))
      .reduce((s, t) => s + taskHours(t).hours, 0);
    expect(remaining).toBe(6 + 5 + 7 + 4 + 6 + 3 + 2);
    expect(projectedHoursBack(measuredWin, office)).toBeCloseTo(remaining * 0.6);
  });

  it("projects nothing without a measured week", () => {
    expect(projectedHoursBack({ ...measuredWin, measuredWeekEnding: null }, office)).toBeNull();
    expect(recoveryRate(null, office)).toBeNull();
  });
});

describe("the guarantee", () => {
  it("is met when the first win gives back at least the guaranteed hours", () => {
    expect(guaranteeMet(measuredWin)).toBe(true);
    expect(guaranteeMet(measuredWin, 7)).toBe(false);
    expect(guaranteeMet({ ...measuredWin, afterMinutesPerUnit: 20 })).toBe(false);
  });

  it("is unknown until measured", () => {
    expect(guaranteeMet(null)).toBeNull();
  });
});

describe("top next wins", () => {
  it("are the best quick wins outside the first win's own group", () => {
    const top = topNextWins(office, measuredWin);
    expect(top.map((g) => g.key)).toEqual(["order entry", "meeting notes"]);
    // Low risk and half a day or less only, highest score first, the
    // first win's group left out, and at most three.
    for (const g of top) expect(g).toMatchObject({ dataRisk: "low", buildEffort: "half_day" });
    const many = [
      ...office,
      task("p11", "Timesheets", 9, 1, 1),
      task("p12", "Purchase orders", 11, 1, 1),
      task("p13", "Courier bookings", 1, 1, 1),
    ];
    expect(topNextWins(many, measuredWin).map((g) => g.key)).toEqual(["order entry", "purchase orders", "timesheets"]);
  });
});

describe("the map and the summary", () => {
  it("places every task and groups the same work together", () => {
    const pts = capacityMap(office);
    expect(pts).toHaveLength(office.length);
    const quoting = pts.filter((p) => p.key === "quoting");
    expect(quoting).toHaveLength(2);
    expect(pts.indexOf(quoting[1]) - pts.indexOf(quoting[0])).toBe(1);
    expect(quoting.find((p) => p.taskId === quoteTask.id)?.checked).toBe(true);
  });

  it("adds up", () => {
    const s = summarize(office, measuredWin);
    expect(s.tasks).toBe(12);
    expect(s.candidates).toBe(8);
    expect(s.checkedHours).toBe(10);
    expect(s.measured).toBe(6);
    expect(s.guaranteeMet).toBe(true);
  });

  it("formats to one decimal", () => {
    expect(formatHours(6)).toBe("6");
    expect(formatHours(20.04)).toBe("20");
    expect(formatHours(19.86)).toBe("19.9");
    expect(formatHours(null)).toBe("Not yet");
  });
});

describe("tasks the lead entered in the walkthrough (0305)", () => {
  const lead = (id: string, title: string, hours: number, role: string | null, extra: Partial<DiagnosticTask> = {}): DiagnosticTask => ({
    id,
    participantId: null,
    roleTitle: role,
    title,
    canonicalTitle: null,
    hoursPerWeek: hours,
    energy: null,
    judgment: null,
    volumeUnitsPerWeek: null,
    minutesPerUnit: null,
    dataRisk: null,
    buildEffortHours: null,
    candidateOverride: null,
    ...extra,
  });

  it("are candidates until the lead leaves one out", () => {
    expect(isCandidate(lead("a", "Invoices", 4, "Bookkeeper"))).toBe(true);
    expect(isCandidate(lead("a", "Invoices", 4, "Bookkeeper", { candidateOverride: false }))).toBe(false);
  });

  it("rank by hours, count roles as heads, and stay off the Capacity Map", () => {
    const tasks = [
      lead("a", "Invoices", 4, "Bookkeeper"),
      lead("b", "Invoices", 2, "bookkeeper"),
      lead("c", "Order entry", 5, "Inside sales"),
      lead("d", "Timesheets", 1, null),
    ];
    const groups = candidateGroups(tasks);
    expect(groups.map((g) => g.title)).toEqual(["Invoices", "Order entry", "Timesheets"]);
    // Unscored on risk and effort: both unset weights.
    expect(groups[0]).toMatchObject({ hours: 6, people: 1, score: 60 + SCORE_WEIGHTS.dataRisk.unset + SCORE_WEIGHTS.buildEffort.unset });
    expect(groups[2].people).toBe(1);
    expect(capacityMap(tasks)).toEqual([]);
    expect(summarize(tasks, null)).toMatchObject({ tasks: 4, candidates: 4, totalHours: 12 });
  });
});
