import { describe, expect, it } from "vitest";
import { commitmentLinkPath, linkCompanyFrom, openIdFrom } from "./link";

const C = "11111111-2222-4333-8444-555555555555";
const CO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("commitment links", () => {
  it("sends a commitment to /commitments, with its company", () => {
    expect(commitmentLinkPath({ id: C, company_id: CO, issue_id: null })).toBe(
      `/commitments?open=${C}&company=${CO}`
    );
  });

  it("sends a commitment on an issue to /issues, which is where it is listed", () => {
    expect(commitmentLinkPath({ id: C, company_id: CO, issue_id: "x" })).toBe(
      `/issues?open=${C}&company=${CO}`
    );
  });

  it("reads back only well-formed ids", () => {
    expect(openIdFrom({ open: C })).toBe(C);
    expect(linkCompanyFrom({ company: CO })).toBe(CO);
    expect(openIdFrom({ open: "/evil" })).toBeNull();
    expect(openIdFrom({ open: [C, C] })).toBeNull();
    expect(linkCompanyFrom({})).toBeNull();
  });
});
