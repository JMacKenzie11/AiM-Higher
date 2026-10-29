import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));
const { alertWorthy, signAlert } = await import("./bot-alerts");

describe("alertWorthy", () => {
  it("alerts going into a problem, between problems, and on recovering from one", () => {
    expect(alertWorthy("running_well", "late")).toBe(true);
    expect(alertWorthy(null, "stopped")).toBe(true);
    expect(alertWorthy("late", "stopped")).toBe(true);
    expect(alertWorthy("needs_attention", "running_well")).toBe(true);
  });

  it("stays quiet for no change, going live, pausing, and a first check that finds it well", () => {
    expect(alertWorthy("late", "late")).toBe(false);
    expect(alertWorthy("not_live", "running_well")).toBe(false);
    expect(alertWorthy("running_well", "not_live")).toBe(false);
    expect(alertWorthy(null, "running_well")).toBe(false);
  });
});

describe("signAlert", () => {
  it("signs the timestamp and body with the secret, as a receiver recomputes it", () => {
    const body = '{"event":"bot.status_changed"}';
    const want = "sha256=" + createHmac("sha256", "s3cret").update(`1793000000.${body}`).digest("hex");
    expect(signAlert(body, "s3cret", 1793000000)).toBe(want);
    expect(signAlert(body, "other", 1793000000)).not.toBe(want);
  });
});
