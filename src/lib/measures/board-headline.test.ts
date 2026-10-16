import { describe, it, expect } from "vitest";
import type { BoardData, BoardStatus } from "./board";
import {
  boardHeadlineText,
  countOffFunctions,
  summarizeBoard,
} from "./board-headline";

// The board's headline is the sentence a leader reads first. It said
// "Everything on target this week" for a company whose measures had no
// targets at all, which is a clean bill of health for a week nothing
// was checked against. These pin the order the line is decided in.

function board(statusesByFunction: BoardStatus[][]): BoardData {
  return {
    weeks: ["2026-10-09", "2026-10-16"],
    currentWeekEnding: "2026-10-16",
    hasEntries: true,
    functions: statusesByFunction.map((statuses, i) => ({
      id: `fn-${i}`,
      title: `Function ${i}`,
      seatHolder: null,
      parentId: null,
      depth: 0,
      metrics: statuses.map((status, j) => ({
        id: `m-${i}-${j}`,
        description: "A measure",
        target: status === "no_target" ? null : "10",
        targetNumeric: status === "no_target" ? null : 10,
        valueType: "number",
        direction: "higher_is_better",
        cells: [
          { weekEnding: "2026-10-09", status, displayValue: "", numericValue: null },
          { weekEnding: "2026-10-16", status, displayValue: "", numericValue: null },
        ],
      })),
    })),
  };
}

function headlineFor(data: BoardData): string {
  return boardHeadlineText(summarizeBoard(data), countOffFunctions(data));
}

describe("board headline", () => {
  it("says no targets are set when no measure has a target", () => {
    const data = board([["no_target", "no_target"], ["no_target"]]);
    expect(summarizeBoard(data).currentEligible).toBe(0);
    expect(headlineFor(data)).toBe("No targets set yet");
  });

  it("says no targets are set when there are no measures at all", () => {
    expect(headlineFor(board([]))).toBe("No targets set yet");
  });

  it("says everything is on target only when every targeted measure was met", () => {
    expect(headlineFor(board([["good", "no_target"], ["good"]]))).toBe(
      "Everything on target this week"
    );
  });

  it("counts measures not logged before calling the week clean", () => {
    expect(headlineFor(board([["good", "unlogged"], ["unlogged"]]))).toBe(
      "2 not logged this week"
    );
  });

  it("names functions off target ahead of anything else", () => {
    expect(headlineFor(board([["off", "off"], ["good"], ["off", "unlogged"]]))).toBe(
      "2 functions off target this week"
    );
    expect(headlineFor(board([["off"], ["good"]]))).toBe(
      "1 function off target this week"
    );
  });

  it("leaves measures with no target out of every count", () => {
    expect(summarizeBoard(board([["good", "off", "unlogged", "no_target"]]))).toEqual({
      currentGood: 1,
      currentOff: 1,
      currentUnlogged: 1,
      currentEligible: 3,
    });
  });
});
