import { describe, expect, it } from "vitest";
import { numbersToLog } from "./to-log";

type G = Parameters<typeof numbersToLog>[0];
const cell = (weekEnding: string, expected: boolean, value: { number: number | null; text: string | null } | null = null) => ({ weekEnding, expected, value });
const grid = (groups: Array<{ canLog: boolean; rows: Array<{ cells: ReturnType<typeof cell>[] }> }>): G =>
  ({ groups, previousWeekEnding: "2026-10-16", currentWeekEnding: "2026-10-23" }) as unknown as G;

describe("numbersToLog", () => {
  it("counts the week just ended, in functions the person may log for", () => {
    const g = grid([
      { canLog: true, rows: [{ cells: [cell("2026-10-16", true)] }, { cells: [cell("2026-10-16", true, { number: 7, text: null })] }] },
      { canLog: false, rows: [{ cells: [cell("2026-10-16", true)] }] },
    ]);
    expect(numbersToLog(g)).toEqual({ week: "2026-10-16", due: 2, outstanding: 1 });
  });

  it("leaves out a measure not due that week", () => {
    const g = grid([{ canLog: true, rows: [{ cells: [cell("2026-10-16", false)] }] }]);
    expect(numbersToLog(g)).toEqual({ week: "2026-10-16", due: 0, outstanding: 0 });
  });

  it("counts a text value as logged", () => {
    const g = grid([{ canLog: true, rows: [{ cells: [cell("2026-10-16", true, { number: null, text: "n/a" })] }] }]);
    expect(numbersToLog(g).outstanding).toBe(0);
  });
});
