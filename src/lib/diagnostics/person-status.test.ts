import { describe, expect, it } from "vitest";
import { personStatus } from "./person-status";

const now = Date.parse("2026-11-02T12:00:00Z");

describe("personStatus", () => {
  it("reads a signed-in person as Active", () => {
    expect(personStatus({ status: "active", invited_at: "2026-10-01T00:00:00Z" }, now).label).toBe("Active");
  });
  it("reads a live invite as Invited and a day-old one as expired", () => {
    expect(personStatus({ status: "pending", invited_at: "2026-11-02T00:00:00Z" }, now)).toMatchObject({ label: "Invited", tone: "waiting" });
    expect(personStatus({ status: "pending", invited_at: "2026-10-31T00:00:00Z" }, now)).toMatchObject({ label: "Invite expired", tone: "bad" });
  });
  it("reads no invite as Not invited, and a switched-off account as Inactive", () => {
    expect(personStatus({ status: "pending", invited_at: null }, now).label).toBe("Not invited");
    expect(personStatus({ status: "inactive", invited_at: null }, now).label).toBe("Inactive");
  });
});
