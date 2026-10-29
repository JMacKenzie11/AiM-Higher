import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));
const { alertHeaders, alertWorthy, signAlert } = await import("./bot-alerts");

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

describe("alertHeaders", () => {
  const body = '{"event":"bot.status_changed"}';

  it("sends the key as a bearer token, as a Grok Bot webhook receiver asks", () => {
    expect(alertHeaders(body, { key: "k3y" }, 1793000000)).toEqual({ "content-type": "application/json", authorization: "Bearer k3y" });
  });

  it("adds the signature when there is a secret, and neither when there is nothing", () => {
    const h = alertHeaders(body, { key: "k3y", secret: "s3cret" }, 1793000000);
    expect(h["x-aims-signature"]).toBe(signAlert(body, "s3cret", 1793000000));
    expect(h["x-aims-timestamp"]).toBe("1793000000");
    expect(alertHeaders(body, {}, 1793000000)).toEqual({ "content-type": "application/json" });
  });
});
