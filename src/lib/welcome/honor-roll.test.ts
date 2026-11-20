import { describe, expect, it } from "vitest";
import { honorRoll, type LastWeekRow } from "./honor-roll";

const row = (owner: string, status: string, by: string | null = owner): LastWeekRow => ({
  owner_id: owner,
  owner_name: `${owner[0].toUpperCase()}${owner.slice(1)} Person`,
  status,
  resolved_by_profile_id: status === "open" ? null : by,
});

describe("honorRoll", () => {
  it("puts people who marked every one done themselves first, as Owned it", () => {
    const r = honorRoll([
      row("jon", "kept_on_time", "casey"), row("jon", "kept_on_time"), row("jon", "kept_late"),
      row("lori", "kept_on_time"), row("lori", "kept_late"),
      row("sam", "kept_on_time"), row("sam", "open"),
    ]);
    expect(r.mode).toBe("clean");
    expect(r.people.map((p) => [p.name, p.ribbon, p.lead, p.celebrate])).toEqual([
      ["Lori Person", "Owned it", true, true],
      ["Jon Person", "Clean sweep", false, false],
    ]);
    expect(r.people[0].why).toBe("2 of 2 kept, every one marked done by Lori.");
    expect(r.people[1].why).toBe("3 of 3 kept.");
  });

  it("never uses a pronoun", () => {
    const r = honorRoll([row("lori", "kept_on_time")]);
    expect(r.people[0].why).not.toMatch(/\b(he|she|him|her|his|hers|himself|herself|they|them|themselves)\b/i);
  });

  it("shows the three closest when nobody kept every one", () => {
    const r = honorRoll([
      row("casey", "kept_on_time"), row("casey", "kept_on_time"), row("casey", "kept_on_time"), row("casey", "open"),
      row("sherri", "kept_on_time"), row("sherri", "kept_on_time"), row("sherri", "kept_on_time"), row("sherri", "open"), row("sherri", "open"),
      row("susan", "kept_on_time"), row("susan", "open"), row("susan", "open"),
      row("ash", "kept_on_time"), row("ash", "open"), row("ash", "open"), row("ash", "open"),
      row("vern", "open"),
    ]);
    expect(r.mode).toBe("closest");
    expect(r.people.map((p) => [p.name, p.ribbon])).toEqual([
      ["Casey Person", "Closest to a clean sweep"],
      ["Sherri Person", "Almost there"],
      ["Susan Person", "Almost there"],
    ]);
    expect(r.people[0].why).toBe("3 of 4 kept. One away from all of them.");
    expect(r.people.some((p) => p.celebrate)).toBe(false);
  });

  it("is empty when nothing was kept, or nothing was due", () => {
    expect(honorRoll([row("vern", "open")]).mode).toBe("none");
    expect(honorRoll([]).mode).toBe("none");
  });

  it("shows six clean sweeps and counts the rest", () => {
    const rows = "abcdefgh".split("").map((c) => row(`p${c}`, "kept_on_time", "someone"));
    const r = honorRoll(rows);
    expect(r.people).toHaveLength(6);
    expect(r.more).toBe(2);
  });
});
