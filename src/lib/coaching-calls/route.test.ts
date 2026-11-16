import { describe, it, expect } from "vitest";
import { matchedBecause, participantsOf, routeCoachCall, suggestAlias, type CoachCompany } from "./route";

// A coach's own folder holds calls with every client. Each call goes to
// one of the coach's ASSIGNED companies, or waits to be sorted (0326).

const RIDGELINE: CoachCompany = {
  id: "co-ridgeline",
  aliases: ["Ridgeline", "RE"],
  people: [
    { id: "p-sam", name: "Sam Patel", email: "sam@ridgeline.example" },
    { id: "p-priya", name: "Priya Shah", email: null },
  ],
};
const HARBOR: CoachCompany = {
  id: "co-harbor",
  aliases: ["Harbor"],
  people: [{ id: "p-dana", name: "Dana Ruiz", email: "dana@harbor.example" }],
};
const COACH = { id: "p-jason", name: "Jason MacKenzie", email: "jason@aims.example" };
const route = (fileName: string, transcript: string, companies = [RIDGELINE, HARBOR]) =>
  routeCoachCall({ fileName, transcript, companies, coach: COACH });

describe("routing a call from a coach's own folder", () => {
  it("files by an alias in the file name", () => {
    expect(route("Ridgeline weekly 1-1 - Transcript", "Speaker 1: hi")).toEqual({
      kind: "routed",
      companyId: "co-ridgeline",
      by: "alias",
      alias: "Ridgeline",
    });
  });

  it("an alias in two companies' names waits, whoever is on the call", () => {
    const d = route("Ridgeline and Harbor joint call", "Dana Ruiz: hello");
    expect(d).toEqual({ kind: "unsorted", reason: "several", companyIds: ["co-ridgeline", "co-harbor"] });
  });

  it("with no alias, files by a person on the call", () => {
    expect(route("Ops check-in", "Jason MacKenzie: Morning.\nDana Ruiz: Morning, Jason.")).toEqual({
      kind: "routed",
      companyId: "co-harbor",
      by: "person",
      personId: "p-dana",
      personName: "Dana Ruiz",
    });
  });

  it("matches a person by email on the attendee list", () => {
    const meet = "Attendees\nsam@ridgeline.example, jason@aims.example\n\nTranscript\nSpeaker 1: hi";
    expect(route("Meeting started 2026-11-12", meet)).toMatchObject({ companyId: "co-ridgeline", by: "person", personId: "p-sam" });
  });

  it("people from two companies on one call: it waits", () => {
    const d = route("Ops check-in", "Dana Ruiz: hi\nSam Patel: hi");
    expect(d).toEqual({ kind: "unsorted", reason: "several", companyIds: ["co-ridgeline", "co-harbor"] });
  });

  it("nothing matches: it waits", () => {
    expect(route("Benson weekly 1:1", "Speaker 1: hi\nSpeaker 2: hello")).toEqual({
      kind: "unsorted",
      reason: "no_match",
      companyIds: [],
    });
  });

  it("the coach is never the match, even when the coach is a person at a company", () => {
    const own: CoachCompany = { id: "co-own", aliases: [], people: [{ id: "p-jason", name: "Jason MacKenzie", email: null }] };
    expect(route("Catch-up", "Jason MacKenzie: hi", [own, HARBOR])).toMatchObject({ kind: "unsorted", reason: "no_match" });
  });

  it("never files into a company the coach is not assigned to", () => {
    // Only the companies passed in exist for the router; the caller
    // passes the coach's assigned companies and nothing else.
    expect(route("Harbor weekly", "Dana Ruiz: hi", [RIDGELINE])).toMatchObject({ kind: "unsorted", reason: "no_match" });
    const d = route("Ridgeline weekly", "Dana Ruiz: hi", [RIDGELINE]);
    expect(d).toMatchObject({ kind: "routed", companyId: "co-ridgeline" });
  });

  it("a speaker label is nobody", () => {
    expect(participantsOf("Speaker 1: hi\nSpeaker 12: hello").names.size).toBe(0);
  });
});

describe("why an auto-filed call matched", () => {
  it("says the alias, or the person", () => {
    expect(matchedBecause({ routed_by_alias: "Ridgeline", personName: null })).toBe('matched "Ridgeline" in the name');
    expect(matchedBecause({ routed_by_alias: null, personName: "Dana Ruiz" })).toBe("matched Dana Ruiz on the call");
    expect(matchedBecause({ routed_by_alias: null, personName: null })).toBeNull();
  });
});

describe("the name offered for future calls", () => {
  it("is the first word of the file name that names something", () => {
    expect(suggestAlias("Benson weekly 1:1 - Transcript")).toBe("Benson");
    expect(suggestAlias("Weekly call with Ridgeline.docx")).toBe("Ridgeline");
    expect(suggestAlias("2026-11-12 Meeting notes")).toBeNull();
  });
});
