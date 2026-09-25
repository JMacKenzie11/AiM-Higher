import { describe, it, expect } from "vitest";
import { dueLabel, BY_NEXT_MEETING } from "./due-label";
import { formatShortDate } from "@/lib/dates";

describe("dueLabel", () => {
  it("says By next meeting when the floor supplied the date", () => {
    expect(dueLabel({ due_date: "2026-09-29", due_date_defaulted: true })).toBe(BY_NEXT_MEETING);
  });

  it("shows the date when somebody named one, and for rows from before the flag", () => {
    expect(dueLabel({ due_date: "2026-09-22", due_date_defaulted: false })).toBe(formatShortDate("2026-09-22"));
    expect(dueLabel({ due_date: "2026-09-22" })).toBe(formatShortDate("2026-09-22"));
  });
});
