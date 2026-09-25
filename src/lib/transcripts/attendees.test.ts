import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { attendeesFromSummary, presentOwnerIds } from "./attendees";
import { requirePresentOwners } from "./analyze";

// Trimmed from the real Benson summary, 2026-09-25.
const SUMMARY = `## Purpose of the Call
Weekly.

## Attendees
- Casey Benson
- Susan Benson
- Ashley Hatt
- Sherri Alderman
- Likely Shawn Warman, unconfirmed
- Darlene Clinch
- Five unidentified speakers

Note: Jon Billings and Lori Watkins were explicitly noted as absent.

## Agenda Items Covered
1. Check-in`;

const ROSTER = [
  { id: "casey", full_name: "Casey Benson" },
  { id: "susan", full_name: "Susan Benson" },
  { id: "ashley", full_name: "Ashley Hatt" },
  { id: "sherri", full_name: "Sherri Alderman" },
  { id: "shawn", full_name: "Shawn Warman" },
  { id: "darlene", full_name: "Darlene Clinch" },
  { id: "jon", full_name: "Jon Billings" },
];

describe("attendeesFromSummary", () => {
  it("reads the bullet list and skips hedged lines and the absence note", () => {
    expect(attendeesFromSummary(SUMMARY)).toEqual([
      "Casey Benson",
      "Susan Benson",
      "Ashley Hatt",
      "Sherri Alderman",
      "Darlene Clinch",
    ]);
  });

  it("returns nothing when there is no attendee list", () => {
    expect(attendeesFromSummary("## Purpose\nNothing here.")).toEqual([]);
  });
});

describe("presentOwnerIds", () => {
  it("counts the speaker map and the summary list, and nobody else", () => {
    const ids = presentOwnerIds(ROSTER, ["Casey Benson"], attendeesFromSummary(SUMMARY))!;
    expect([...ids].sort()).toEqual(["ashley", "casey", "darlene", "sherri", "susan"]);
    expect(ids.has("jon")).toBe(false);
    expect(ids.has("shawn")).toBe(false);
  });

  it("does not run when nobody is named at all", () => {
    expect(presentOwnerIds(ROSTER, [], [])).toBeNull();
  });
});

describe("requirePresentOwners", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const base = { due_date: "2026-09-29", priority_id: null };

  it("clears the real case: the success-measures numbers on Jon, who was absent", () => {
    const out = requirePresentOwners(
      [
        { ...base, owner_profile_id: "jon", description: "John to try to get his weekly numbers added." },
        { ...base, owner_profile_id: "casey", description: "Casey to post the shutdown announcement." },
      ],
      presentOwnerIds(ROSTER, ["Casey Benson"], attendeesFromSummary(SUMMARY)),
      "m1"
    );
    expect(out.map((c) => c.owner_profile_id)).toEqual([null, "casey"]);
    expect(out[0].description).toBe("John to try to get his weekly numbers added.");
  });

  it("leaves everything alone when presence is unknown", () => {
    const input = [{ ...base, owner_profile_id: "jon", description: "x" }];
    expect(requirePresentOwners(input, null, "m1")).toEqual(input);
    log.mockRestore();
  });
});
