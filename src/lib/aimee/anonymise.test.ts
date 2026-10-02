import { describe, it, expect } from "vitest";
import { anonymiser } from "./anonymise";

const a = anonymiser({ people: ["Marcus Bell", "Sam Lee", "Will Ortiz"], companies: ["Benson Seafood", "Acme"] });

describe("scrub, before the model", () => {
  it("takes out roster names, company names, emails and phone numbers", () => {
    expect(
      a.scrub("Marcus keeps missing the handoff at Benson Seafood. Email marcus@benson.com or call +1 (555) 201-3344. Sam Lee agreed.")
    ).toBe(
      "a colleague keeps missing the handoff at the company. Email an email address or call a phone number. a colleague agreed."
    );
  });

  it("leaves ordinary words alone, matching names as written", () => {
    expect(a.scrub("We will mark the samples and bill the client.")).toBe("We will mark the samples and bill the client.");
    expect(a.scrub("Lee's team and Bell's numbers")).toBe("a colleague's team and a colleague's numbers");
  });
});

describe("faults, before anything is stored", () => {
  it("names each kind of fault, never the text", () => {
    expect(a.faults("A leader worried that Marcus would quit.")).toEqual(["a name"]);
    expect(a.faults("The CEO is weighing a restructure.")).toEqual(["a role that identifies one person"]);
    expect(a.faults("Our only finance person is overloaded.")).toEqual(["a role that identifies one person"]);
    expect(a.faults("A report is out on maternity leave.")).toEqual(["a personal detail"]);
    expect(a.faults("Acme's founder wants out.")).toEqual(["a name", "a role that identifies one person"]);
  });

  it("passes an anonymous summary", () => {
    expect(a.faults("A leader is preparing a hard conversation with a report about missed handoffs.")).toEqual([]);
    expect(a.faults("Sales pipeline health and a process owner for scheduling.")).toEqual([]);
  });
});
