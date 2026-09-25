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

// The real Geo-Sci 06 Aug attendee section, written as prose. The
// bullet-only parser found nobody here and cleared every one of Jeff's
// commitments on three runs out of three (2026-09-25).
const PROSE = `## Attendees

Jeff Bouwman, Woody Aboumrad, George Aboumrad, Andy Hunt, Kyle Carey. One unidentified speaker also participated throughout the call. Jordan Bogdan and Chris Hemme were referenced extensively as absent (Jordan on a job site, Chris on vacation) but did not attend.

## Agenda Items Covered`;

describe("attendees written as prose", () => {
  it("reads the names, and skips the unidentified and absent sentences", () => {
    expect(attendeesFromSummary(PROSE)).toEqual([
      "Jeff Bouwman",
      "Woody Aboumrad",
      "George Aboumrad",
      "Andy Hunt",
      "Kyle Carey",
    ]);
  });

  it("strips roles from bullets, in either shape", () => {
    expect(
      attendeesFromSummary(`## Attendees\n- Casey Benson (CEO)\n- Darlene Clinch (Processing Plant Manager, Acting)\n- Sherri Alderman — HR Manager\n- Likely Shawn Warman, unconfirmed\n`)
    ).toEqual(["Casey Benson", "Darlene Clinch", "Sherri Alderman"]);
  });
});

describe("assigned AiMS guides count as present", () => {
  const roster = [
    { id: "jeff-admin", full_name: "Jeff Bouwman" },
    { id: "chris", full_name: "Chris Hemme" },
  ];

  it("keeps Jeff's commitments from the real prose section, and still clears absent Chris", () => {
    const present = presentOwnerIds(roster, [], attendeesFromSummary(PROSE), ["jeff-guide", "jeff-admin"])!;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = requirePresentOwners(
      [
        { due_date: "2026-08-13", priority_id: null, owner_profile_id: "jeff-admin", description: "Jeff will record the meeting and share the replay." },
        { due_date: "2026-08-13", priority_id: null, owner_profile_id: "chris", description: "Chris will provide weekly reports." },
      ],
      present,
      "m1"
    );
    expect(out.map((c) => c.owner_profile_id)).toEqual(["jeff-admin", null]);
    log.mockRestore();
  });

  it("counts an assigned guide the summary never lists", () => {
    expect(presentOwnerIds(roster, [], [], ["jeff-admin"])).toEqual(new Set(["jeff-admin"]));
  });
});
