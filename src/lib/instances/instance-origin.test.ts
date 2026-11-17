import { describe, expect, it } from "vitest";
import { instanceOrigin } from "./instance-origin";

describe("instanceOrigin", () => {
  it("is APP_URL for the primary instance", () => {
    expect(instanceOrigin("@", "https://www.aims-hq.com")).toBe("https://www.aims-hq.com");
  });
  it("is the subdomain on the same domain for any other", () => {
    expect(instanceOrigin("acme", "https://www.aims-hq.com")).toBe("https://acme.aims-hq.com");
    expect(instanceOrigin("acme", "https://aims-hq.com")).toBe("https://acme.aims-hq.com");
  });
  it("is APP_URL where there are no subdomains to point at", () => {
    expect(instanceOrigin("acme", "http://localhost:3200")).toBe("http://localhost:3200");
    expect(instanceOrigin("acme", "https://aims-higher-git-x.vercel.app")).toBe("https://aims-higher-git-x.vercel.app");
  });
});
