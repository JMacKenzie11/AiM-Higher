import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/supabase/env", () => ({
  APP_URL: () => "https://build-time.example.com",
}));

import { currentRequestOrigin } from "@/lib/instances/origin";

// The origin an auth link points back at decides WHICH SUPABASE
// PROJECT verifies its token, because middleware resolves the
// instance from the hostname. Getting it wrong does not mis-route a
// user to a cosmetically wrong page; it hands their token to a
// database that has never seen it, and the app tells them the link
// expired.

function withHeaders(h: Record<string, string>) {
  mocks.headers.mockResolvedValue({
    get: (k: string) => h[k.toLowerCase()] ?? null,
  });
}

describe("currentRequestOrigin", () => {
  it("uses the request's own host, not the build-time app URL", async () => {
    // The whole bug. One Vercel deployment serves every instance, so
    // NEXT_PUBLIC_APP_URL is a single value and is right for at most
    // one of them.
    withHeaders({
      "x-forwarded-host": "promiseone.aims-hq.com",
      "x-forwarded-proto": "https",
    });
    expect(await currentRequestOrigin()).toBe("https://promiseone.aims-hq.com");
  });

  it("prefers x-forwarded-host over Host, as instance resolution does", async () => {
    // Must agree with hostnameFromHeaders, or a link would be built
    // for one instance and resolved as another.
    withHeaders({
      "x-forwarded-host": "acme.aims-hq.com",
      host: "internal-vercel-host",
      "x-forwarded-proto": "https",
    });
    expect(await currentRequestOrigin()).toBe("https://acme.aims-hq.com");
  });

  it("takes the first entry of a forwarded chain", async () => {
    withHeaders({
      "x-forwarded-host": "acme.aims-hq.com, proxy.internal",
      "x-forwarded-proto": "https, http",
    });
    expect(await currentRequestOrigin()).toBe("https://acme.aims-hq.com");
  });

  it("stays on http for localhost so dev links are clickable", async () => {
    withHeaders({ host: "localhost:3200" });
    expect(await currentRequestOrigin()).toBe("http://localhost:3200");
  });

  it("assumes https for a real hostname with no proto header", async () => {
    withHeaders({ host: "acme.aims-hq.com" });
    expect(await currentRequestOrigin()).toBe("https://acme.aims-hq.com");
  });

  it("falls back to the app URL outside a request scope", async () => {
    // Background work has no host to read. APP_URL is then the only
    // answer available, and it is the RIGHT answer for the primary
    // instance, which is the one background work mostly concerns.
    // Synchronously, which is how next/headers actually behaves
    // outside a request scope. A rejected promise here surfaces as an
    // unhandled rejection instead of reaching the catch.
    mocks.headers.mockImplementation(() => {
      throw new Error("called outside a request");
    });
    expect(await currentRequestOrigin()).toBe("https://build-time.example.com");
  });

  it("falls back when the headers carry no host at all", async () => {
    withHeaders({});
    expect(await currentRequestOrigin()).toBe("https://build-time.example.com");
  });
});

// SOURCE GUARD. An auth link built from the build-time app URL is
// broken for every instance except the primary one, and broken in a
// way that reads as "your link expired" rather than as a bug. The
// next one is whichever auth link somebody adds next.
describe("auth links never use the build-time app URL", () => {
  it("no APP_URL() in the files that mint invite and reset links", async () => {
    const { readFileSync } = await import("node:fs");
    const offenders: string[] = [];
    for (const file of [
      "src/lib/auth/users.ts",
      "src/lib/auth/actions.ts",
      "src/lib/auth/provision-user.ts",
    ]) {
      const src = readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
      if (/APP_URL\(\)/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
