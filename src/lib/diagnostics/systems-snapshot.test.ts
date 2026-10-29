import { describe, it, expect } from "vitest";
import { aiSummary, hasSystemsData, systemsSnapshot } from "./systems-snapshot";
import { capacityMap, isCandidate } from "./hours-back";
import { toTask } from "./types";
import { BOOKS, EMAIL, ERP, frontOffice, SHEET } from "./systems.fixture";

const office = frontOffice();
const snapshot = systemsSnapshot({ ...office, tasks: office.tasks.map(toTask) });
const pair = (from: string, to: string) => snapshot.connections.find((c) => c.fromId === from && c.toId === to);

describe("hours carried between systems", () => {
  it("sums the copying tasks' hours on each connection, checked hours where there are any", () => {
    expect(pair(EMAIL, ERP)).toMatchObject({ hoursCarried: 10, tasks: 2, handCarried: true, how: "retyped" });
    expect(pair(ERP, BOOKS)).toMatchObject({ hoursCarried: 1, tasks: 1, handCarried: false, how: "automatic" });
  });

  it("counts a copy the other way against the connection when there is none its own way", () => {
    expect(pair(SHEET, BOOKS)).toMatchObject({ hoursCarried: 5, tasks: 2 });
  });

  it("counts a task once when links run both ways", () => {
    const both = systemsSnapshot({
      ...office,
      links: [...office.links, { from_system_id: BOOKS, to_system_id: SHEET, what_moves: "Prices", how: "retyped" }],
      tasks: office.tasks.map(toTask),
    });
    const there = both.connections.find((c) => c.fromId === SHEET && c.toId === BOOKS)!;
    const back = both.connections.find((c) => c.fromId === BOOKS && c.toId === SHEET)!;
    expect([there.hoursCarried, back.hoursCarried]).toEqual([3, 2]);
  });

  it("makes two links between the same systems one connection", () => {
    const two = systemsSnapshot({
      ...office,
      links: [...office.links, { from_system_id: EMAIL, to_system_id: ERP, what_moves: "Customer changes", how: "unknown" }],
      tasks: office.tasks.map(toTask),
    });
    expect(two.connections.filter((c) => c.fromId === EMAIL && c.toId === ERP)).toHaveLength(1);
    expect(two.connections.find((c) => c.fromId === EMAIL)).toMatchObject({ whatMoves: ["Orders", "Customer changes"], how: "retyped", hoursCarried: 10 });
  });
});

describe("hand-carried connections", () => {
  it("ranks the typed and exported ones by hours carried, and leaves out the automatic one", () => {
    expect(snapshot.handCarried.map((c) => [c.from, c.to, c.hoursCarried])).toEqual([
      ["Outlook", "Epicor", 10],
      ["Quote sheet", "QuickBooks", 5],
    ]);
    expect(snapshot.handCarriedHours).toBe(15);
  });
});

describe("unlinked copying", () => {
  it("lists a copy pair no link covers, for the assessor to add", () => {
    expect(snapshot.unlinked).toEqual([{ fromId: EMAIL, toId: SHEET, from: "Outlook", to: "Quote sheet", tasks: 1, hours: 6 }]);
  });
});

describe("AI use", () => {
  it("counts the surveyed who answered, None included, and names tools by users", () => {
    expect(snapshot.ai).toEqual({
      answered: 4,
      usingAny: 3,
      usingPersonal: 1,
      tools: [
        { tool: "ChatGPT", users: 2 },
        { tool: "Copilot", users: 1 },
      ],
      companyProvided: 2,
      personal: 1,
    });
  });

  it("counts None as an answer with no tools", () => {
    const s = aiSummary([{ id: "p", survey_entered_at: "2026-10-02", uses_no_ai: true }], []);
    expect(s).toMatchObject({ answered: 1, usingAny: 0, tools: [] });
  });

  it("keeps the uses as written for the assessor", () => {
    expect(snapshot.usesAsWritten).toContain("Drafting replies");
  });
});

describe("whether there is systems data", () => {
  it("is true with a system, a tool or a None, and false with none of them", () => {
    expect(hasSystemsData(office)).toBe(true);
    expect(hasSystemsData({ systems: [], aiUse: [], participants: office.participants.map((p) => ({ ...p, uses_no_ai: false })) })).toBe(false);
    expect(hasSystemsData({ systems: [], aiUse: [], participants: office.participants })).toBe(true);
  });
});

describe("copying on the Capacity Map", () => {
  it("rings a copying task and leaves the candidate rule alone", () => {
    const tasks = office.tasks.map(toTask);
    const points = capacityMap(tasks);
    expect(points.find((p) => p.taskId === "t2")?.copying).toBe(true);
    expect(points.find((p) => p.taskId === "t7")).not.toHaveProperty("copying");
    expect(tasks.map(isCandidate)).toEqual(tasks.map((t) => t.energy! <= 2 && t.judgment! <= 2));
  });
});
