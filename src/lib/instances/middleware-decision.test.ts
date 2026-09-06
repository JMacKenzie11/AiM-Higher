import { describe, it, expect, vi } from "vitest";

import {
  routeForInstance,
  isInstanceExemptPath,
  INSTANCE_NOT_FOUND_PATH,
} from "./middleware-decision";
import { resolveInstance } from "./resolve";
import { needsScopePicker } from "@/lib/admin/scope-request";
import {
  INSTANCE_HEADER,
  hostnameFromHeaders,
  parseInstanceHeader,
  serializeInstance,
} from "./request";
import type { InstanceConfig } from "./types";

// The middleware rule, tested without a NextRequest. Middleware calls
// resolveInstance and hands the result to routeForInstance; these
// tests drive that same pair.

const ACME: InstanceConfig = {
  subdomain: "acme",
  displayName: "Acme Industries",
  supabaseUrl: "https://acme.supabase.co",
  supabaseAnonKey: "acme-anon",
  supabaseServiceKey: "acme-service",
  status: "active",
};

function lookupFor(known: Record<string, InstanceConfig>) {
  return vi.fn(async (subdomain: string) => known[subdomain] ?? null);
}

describe("routeForInstance", () => {
  it("proceeds when the hostname resolved", () => {
    expect(
      routeForInstance({ pathname: "/dashboard", instance: ACME }),
    ).toEqual({ action: "proceed", instance: ACME });
  });

  it("rewrites to instance-not-found when it did not", () => {
    expect(routeForInstance({ pathname: "/dashboard", instance: null })).toEqual(
      { action: "rewrite", to: INSTANCE_NOT_FOUND_PATH },
    );
  });

  it("rewrites every path, not just app routes", () => {
    // The marketing landing page and the auth pages must be
    // unreachable on a hostname that is nobody's instance.
    for (const pathname of ["/", "/sign-in", "/accept-invite", "/admin/companies"]) {
      expect(routeForInstance({ pathname, instance: null }).action).toBe(
        "rewrite",
      );
    }
  });

  it("passes the not-found page through instead of rewriting it again", () => {
    // Without this the rewrite target would itself rewrite, forever.
    expect(
      routeForInstance({ pathname: INSTANCE_NOT_FOUND_PATH, instance: null }),
    ).toEqual({ action: "passthrough" });
  });

  it("passes the not-found page through even on a hostname that resolves", () => {
    expect(
      routeForInstance({ pathname: INSTANCE_NOT_FOUND_PATH, instance: ACME }),
    ).toEqual({ action: "passthrough" });
  });
});

describe("resolution as middleware calls it", () => {
  it("proceeds for a known hostname", async () => {
    const lookup = lookupFor({ acme: ACME });
    const resolved = await resolveInstance("acme.example.com", {}, lookup);

    expect(routeForInstance({ pathname: "/dashboard", instance: resolved })).toEqual(
      { action: "proceed", instance: ACME },
    );
    expect(lookup).toHaveBeenCalledWith("acme");
  });

  it("rewrites for an unknown hostname", async () => {
    const lookup = lookupFor({ acme: ACME });
    const resolved = await resolveInstance("nobody.example.com", {}, lookup);

    expect(resolved).toBeNull();
    expect(
      routeForInstance({ pathname: "/dashboard", instance: resolved }).action,
    ).toBe("rewrite");
  });

  it("short-circuits the registry entirely when the local override is set", async () => {
    const lookup = lookupFor({ acme: ACME });
    const resolved = await resolveInstance(
      "acme.example.com",
      {
        LOCAL_INSTANCE_SUPABASE_URL: "http://127.0.0.1:54321",
        LOCAL_INSTANCE_SUPABASE_ANON_KEY: "local-anon",
        LOCAL_INSTANCE_SUPABASE_SERVICE_KEY: "local-service",
      },
      lookup,
    );

    // The override wins over a hostname the registry would have
    // matched, and the control plane is never asked.
    expect(resolved?.supabaseUrl).toBe("http://127.0.0.1:54321");
    expect(lookup).not.toHaveBeenCalled();
    expect(
      routeForInstance({ pathname: "/dashboard", instance: resolved }).action,
    ).toBe("proceed");
  });
});

describe("the instance request header", () => {
  it("round-trips a config", () => {
    expect(parseInstanceHeader(serializeInstance(ACME))).toEqual(ACME);
  });

  it("is named as an internal header", () => {
    expect(INSTANCE_HEADER).toBe("x-aims-instance");
  });

  it("returns null for anything malformed", () => {
    // A malformed header must fall through to the env fallback rather
    // than build a client with undefined credentials.
    for (const raw of [
      null,
      undefined,
      "",
      "not json",
      "{}",
      JSON.stringify({ ...ACME, supabaseUrl: 42 }),
      JSON.stringify({ ...ACME, status: "deleted" }),
    ]) {
      expect(parseInstanceHeader(raw)).toBeNull();
    }
  });
});

describe("instance resolution alongside the existing middleware rules", () => {
  const COMPANY = "11111111-1111-4111-8111-111111111111";

  it("sends an unscoped operator to the picker, on a resolved instance", async () => {
    // Resolution runs before everything else in middleware now, so
    // this pins that it did not disturb the ordering the scope rule
    // depends on. A company URL resolves its instance and then, for a
    // cross-tenant role that is not scoped into it, goes to the
    // picker rather than scoping them in.
    const resolved = await resolveInstance(
      "acme.example.com",
      {},
      lookupFor({ acme: ACME }),
    );
    expect(routeForInstance({ pathname: `/admin/companies/${COMPANY}`, instance: resolved }).action).toBe("proceed");

    expect(
      needsScopePicker({
        pathname: `/admin/companies/${COMPANY}`,
        currentScope: null,
        role: "system_admin",
      }),
    ).toBe(true);
  });

  it("lets an already-scoped deep link through, on a resolved instance", async () => {
    const resolved = await resolveInstance(
      "acme.example.com",
      {},
      lookupFor({ acme: ACME }),
    );
    expect(routeForInstance({ pathname: `/admin/companies/${COMPANY}`, instance: resolved }).action).toBe("proceed");

    expect(
      needsScopePicker({
        pathname: `/admin/companies/${COMPANY}`,
        currentScope: COMPANY,
        role: "system_admin",
      }),
    ).toBe(false);
  });
});

describe("hostnameFromHeaders", () => {
  // next dev reports "localhost" on nextUrl.hostname for every
  // request regardless of the Host sent, so resolution reads the
  // headers instead. These pin that.

  it("prefers x-forwarded-host over Host", () => {
    const headers = new Headers({
      "x-forwarded-host": "acme.example.com",
      host: "localhost:3200",
    });
    expect(hostnameFromHeaders(headers, "localhost")).toBe("acme.example.com");
  });

  it("takes the first entry of a forwarded chain", () => {
    const headers = new Headers({
      "x-forwarded-host": "acme.example.com, proxy.internal",
    });
    expect(hostnameFromHeaders(headers, "localhost")).toBe("acme.example.com");
  });

  it("falls back to Host when nothing is forwarded", () => {
    const headers = new Headers({ host: "acme.example.com:3200" });
    expect(hostnameFromHeaders(headers, "localhost")).toBe(
      "acme.example.com:3200",
    );
  });

  it("falls back to the supplied value when neither header is present", () => {
    expect(hostnameFromHeaders(new Headers(), "localhost")).toBe("localhost");
  });

  it("feeds resolution a host that a dev machine can actually set", async () => {
    // The whole point: a Host header of acme.example.com must reach
    // the registry as the subdomain "acme", even though nextUrl would
    // have said "localhost" and resolved to nothing.
    const lookup = lookupFor({ acme: ACME });
    const headers = new Headers({ host: "acme.example.com:3200" });

    const resolved = await resolveInstance(
      hostnameFromHeaders(headers, "localhost"),
      {},
      lookup,
    );

    expect(lookup).toHaveBeenCalledWith("acme");
    expect(routeForInstance({ pathname: "/dashboard", instance: resolved })).toEqual(
      { action: "proceed", instance: ACME },
    );
  });

  it("resolves an unknown Host to the not-found page", async () => {
    const resolved = await resolveInstance(
      hostnameFromHeaders(
        new Headers({ host: "nobody.example.com:3200" }),
        "localhost",
      ),
      {},
      lookupFor({ acme: ACME }),
    );

    expect(
      routeForInstance({ pathname: "/", instance: resolved }),
    ).toEqual({ action: "rewrite", to: INSTANCE_NOT_FOUND_PATH });
  });
});

describe("isInstanceExemptPath", () => {
  it("exempts the cron routes", () => {
    for (const pathname of [
      "/api/cron/transcripts",
      "/api/cron/themes",
      "/api/cron/coaching-insights",
      "/api/cron/anthropic-cost",
      "/api/cron/scorecard",
      "/api/cron/performance",
      "/api/cron",
    ]) {
      expect(isInstanceExemptPath(pathname)).toBe(true);
    }
  });

  it("exempts nothing else", () => {
    // Every other route belongs to a visitor on a hostname, and a
    // hostname is exactly what resolution needs.
    for (const pathname of [
      "/",
      "/sign-in",
      "/dashboard",
      "/admin/companies",
      "/api/oauth/google/callback",
      "/api/strengths/generate-results",
      INSTANCE_NOT_FOUND_PATH,
    ]) {
      expect(isInstanceExemptPath(pathname)).toBe(false);
    }
  });

  it("is not fooled by a path that merely starts with the same letters", () => {
    // /api/crontab is not a cron route. Prefix matching has to stop
    // at the separator or the exemption widens on its own.
    expect(isInstanceExemptPath("/api/crontab")).toBe(false);
    expect(isInstanceExemptPath("/api/cronies/list")).toBe(false);
  });
});
