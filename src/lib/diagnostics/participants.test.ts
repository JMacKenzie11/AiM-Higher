import { describe, it, expect } from "vitest";
import { parseParticipantLines } from "./participants";

describe("parseParticipantLines", () => {
  it("reads a typed list and a pasted spreadsheet column", () => {
    expect(
      parseParticipantLines("Dana Ruiz, Estimator, dana@acme.ca\n\nLee Park\tCustomer service\nSam Ode, sam@acme.ca")
    ).toEqual([
      { name: "Dana Ruiz", role_title: "Estimator", email: "dana@acme.ca" },
      { name: "Lee Park", role_title: "Customer service", email: null },
      { name: "Sam Ode", role_title: null, email: "sam@acme.ca" },
    ]);
  });

  it("skips blank lines and stray separators", () => {
    expect(parseParticipantLines(" , \n\t\n")).toEqual([]);
  });
});
