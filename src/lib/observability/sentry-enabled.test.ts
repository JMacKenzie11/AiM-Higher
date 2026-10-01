import { describe, expect, it } from "vitest";
import {
  browserSentryEnvironment,
  sentryEnabledForHostname,
  sentryEnabledOnServer,
} from "./sentry-enabled";

describe("sentryEnabledForHostname", () => {
  it.each([
    ["localhost"],
    ["LOCALHOST"],
    ["app.localhost"],
    ["127.0.0.1"],
    ["127.1.2.3"],
    ["::1"],
    ["[::1]"],
    ["0.0.0.0"],
    ["jasons-macbook.local"],
    ["jasons-macbook.local."],
    ["10.0.0.5"],
    ["10.255.255.255"],
    ["172.16.0.1"],
    ["172.20.10.2"],
    ["172.31.255.255"],
    ["192.168.0.1"],
    ["192.168.127.141"], // the dev server reached from a phone on the LAN
    ["169.254.10.10"],
    [""],
  ])("is off for %s", (host) => {
    expect(sentryEnabledForHostname(host)).toBe(false);
  });

  it.each([
    ["www.aims-hq.com"], // production
    ["aims-hq.com"],
    ["acme.aims-hq.com"], // a customer instance
    ["aimhigher-git-some-branch-aims-institute.vercel.app"], // preview
    ["172.15.0.1"], // just outside 172.16/12
    ["172.32.0.1"],
    ["192.169.0.1"],
    ["11.0.0.1"],
  ])("is on for %s", (host) => {
    expect(sentryEnabledForHostname(host)).toBe(true);
  });

  it("does not mistake a public name that merely contains 'local'", () => {
    expect(sentryEnabledForHostname("localbank.com")).toBe(true);
    expect(sentryEnabledForHostname("local.aims-hq.com")).toBe(true);
  });
});

describe("sentryEnabledOnServer", () => {
  it("is on for Vercel production and preview", () => {
    expect(
      sentryEnabledOnServer({ VERCEL: "1", VERCEL_ENV: "production" })
    ).toBe(true);
    expect(sentryEnabledOnServer({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe(
      true
    );
  });

  it("is off when not on Vercel", () => {
    expect(sentryEnabledOnServer({})).toBe(false);
    expect(sentryEnabledOnServer({ VERCEL_ENV: "production" })).toBe(false);
    expect(sentryEnabledOnServer({ VERCEL: "0" })).toBe(false);
  });

  it("is off for a `vercel env pull` file on a laptop", () => {
    expect(
      sentryEnabledOnServer({ VERCEL: "1", VERCEL_ENV: "development" })
    ).toBe(false);
  });
});

describe("browserSentryEnvironment", () => {
  it("uses the Vercel environment when the build had one", () => {
    expect(browserSentryEnvironment("production")).toBe("production");
    expect(browserSentryEnvironment("preview")).toBe("preview");
  });

  it("falls back to production when the build had none", () => {
    expect(browserSentryEnvironment(undefined)).toBe("production");
    expect(browserSentryEnvironment("")).toBe("production");
  });
});
