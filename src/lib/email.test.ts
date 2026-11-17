import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { senderFrom } from "./email";

describe("senderFrom", () => {
  it("names every email AiMS-HQ when EMAIL_FROM carries another name", () => {
    expect(senderFrom("AiMS <noreply@aims-hq.com>")).toBe("AiMS-HQ <noreply@aims-hq.com>");
  });

  it("keeps the address from a bare EMAIL_FROM", () => {
    expect(senderFrom("hello@example.com")).toBe("AiMS-HQ <hello@example.com>");
  });

  it("falls back to the production address when EMAIL_FROM is unset or blank", () => {
    expect(senderFrom(undefined)).toBe("AiMS-HQ <noreply@aims-hq.com>");
    expect(senderFrom("  ")).toBe("AiMS-HQ <noreply@aims-hq.com>");
  });
});
