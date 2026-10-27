import { describe, it, expect } from "vitest";
import { ago, cost, expiresIn } from "./format";

const now = new Date("2026-10-27T15:00:00Z").getTime();

describe("ago", () => {
  it("reads minutes, hours and days", () => {
    expect(ago("2026-10-27T14:59:50Z", now)).toBe("just now");
    expect(ago("2026-10-27T14:19:00Z", now)).toBe("41 min ago");
    expect(ago("2026-10-27T14:00:00Z", now)).toBe("1 hour ago");
    expect(ago("2026-10-25T15:00:00Z", now)).toBe("2 days ago");
  });
});

describe("expiresIn", () => {
  it("counts down a day", () => {
    expect(expiresIn("2026-10-27T14:00:00Z", 24, now)).toBe("23 hours");
    expect(expiresIn("2026-10-26T15:20:00Z", 24, now)).toBe("20 min");
    expect(expiresIn("2026-10-25T15:00:00Z", 24, now)).toBe("0 min");
  });
});

describe("cost", () => {
  it("shows cents to the cent", () => {
    expect(cost(0)).toBe("$0.00");
    expect(cost(0.4)).toBe("under 1¢");
    expect(cost(7.2)).toBe("$0.07");
  });
});
