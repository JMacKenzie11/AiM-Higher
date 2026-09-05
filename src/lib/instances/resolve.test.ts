import { describe, it, expect, vi } from "vitest";

import { resolveInstance } from "./resolve";
import type { InstanceConfig } from "./types";

// The registry stand-in. One known instance and one suspended one;
// everything else is unknown.
const REGISTRY: Record<string, InstanceConfig> = {
  acme: {
    subdomain: "acme",
    displayName: "Acme",
    supabaseUrl: "https://acme.supabase.co",
    supabaseAnonKey: "acme-anon",
    supabaseServiceKey: "acme-service",
    status: "active",
  },
  dormant: {
    subdomain: "dormant",
    displayName: "Dormant Co",
    supabaseUrl: "https://dormant.supabase.co",
    supabaseAnonKey: "dormant-anon",
    supabaseServiceKey: "dormant-service",
    status: "suspended",
  },
};

function makeLookup() {
  return vi.fn(async (subdomain: string) => REGISTRY[subdomain] ?? null);
}

const PREVIEW_ENV = {
  PREVIEW_INSTANCE_SUPABASE_URL: "https://preview.supabase.co",
  PREVIEW_INSTANCE_SUPABASE_ANON_KEY: "preview-anon",
  PREVIEW_INSTANCE_SUPABASE_SERVICE_KEY: "preview-service",
};

const LOCAL_ENV = {
  LOCAL_INSTANCE_SUPABASE_URL: "http://127.0.0.1:54321",
  LOCAL_INSTANCE_SUPABASE_ANON_KEY: "local-anon",
  LOCAL_INSTANCE_SUPABASE_SERVICE_KEY: "local-service",
};

describe("resolveInstance", () => {
  it("lets the local override win over a hostname the registry knows", async () => {
    const lookup = makeLookup();
    const result = await resolveInstance("acme.example.com", LOCAL_ENV, lookup);

    expect(result?.supabaseUrl).toBe("http://127.0.0.1:54321");
    expect(result?.supabaseAnonKey).toBe("local-anon");
    expect(result?.supabaseServiceKey).toBe("local-service");
    expect(result?.status).toBe("active");
    // The hostname is ignored entirely, so the registry is never asked.
    expect(lookup).not.toHaveBeenCalled();
  });

  it("takes the local override even on a preview hostname", async () => {
    const lookup = makeLookup();
    const result = await resolveInstance(
      "aims-git-branch.vercel.app",
      { ...LOCAL_ENV, ...PREVIEW_ENV },
      lookup,
    );

    expect(result?.supabaseUrl).toBe("http://127.0.0.1:54321");
  });

  it("throws when the local override is only half set", async () => {
    const lookup = makeLookup();

    // Returning null here would look exactly like an unknown hostname,
    // and the developer would debug their subdomain instead of the
    // typo in their .env.local. The error names what is missing.
    await expect(
      resolveInstance(
        "acme.example.com",
        { LOCAL_INSTANCE_SUPABASE_URL: "http://127.0.0.1:54321" },
        lookup,
      ),
    ).rejects.toThrow(
      /Missing: LOCAL_INSTANCE_SUPABASE_ANON_KEY, LOCAL_INSTANCE_SUPABASE_SERVICE_KEY/,
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it("throws when any single local variable is missing", async () => {
    for (const missing of [
      "LOCAL_INSTANCE_SUPABASE_URL",
      "LOCAL_INSTANCE_SUPABASE_ANON_KEY",
      "LOCAL_INSTANCE_SUPABASE_SERVICE_KEY",
    ]) {
      const env: Record<string, string | undefined> = { ...LOCAL_ENV };
      delete env[missing];

      await expect(
        resolveInstance("acme.example.com", env, makeLookup()),
      ).rejects.toThrow(`Missing: ${missing}`);
    }
  });

  it("throws on a partial local override even on a preview hostname", async () => {
    // The check runs before anything looks at the hostname, so a
    // broken .env.local cannot hide behind a preview URL.
    await expect(
      resolveInstance(
        "aims-git-branch.vercel.app",
        { ...PREVIEW_ENV, LOCAL_INSTANCE_SUPABASE_ANON_KEY: "local-anon" },
        makeLookup(),
      ),
    ).rejects.toThrow(/Incomplete local instance override/);
  });

  it("routes .vercel.app to the preview config", async () => {
    const lookup = makeLookup();
    const result = await resolveInstance(
      "aims-git-branch-team.vercel.app",
      PREVIEW_ENV,
      lookup,
    );

    expect(result).toEqual({
      subdomain: "preview",
      displayName: "Preview",
      supabaseUrl: "https://preview.supabase.co",
      supabaseAnonKey: "preview-anon",
      supabaseServiceKey: "preview-service",
      status: "active",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("returns null on .vercel.app when the preview variables are missing", async () => {
    const lookup = makeLookup();

    expect(
      await resolveInstance("aims-git-branch.vercel.app", {}, lookup),
    ).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("returns null on .vercel.app when the preview config is only half set", async () => {
    const lookup = makeLookup();

    // A deployment wired up halfway fails closed rather than
    // connecting with an empty key.
    expect(
      await resolveInstance(
        "aims-git-branch.vercel.app",
        { PREVIEW_INSTANCE_SUPABASE_URL: "https://preview.supabase.co" },
        lookup,
      ),
    ).toBeNull();
  });

  it("strips the port before resolving", async () => {
    const lookup = makeLookup();
    const result = await resolveInstance("acme.example.com:3200", {}, lookup);

    expect(result).toEqual(REGISTRY.acme);
    expect(lookup).toHaveBeenCalledWith("acme");
  });

  it("strips the port on a preview hostname too", async () => {
    const result = await resolveInstance(
      "aims-git-branch.vercel.app:3000",
      PREVIEW_ENV,
      makeLookup(),
    );

    expect(result?.supabaseUrl).toBe("https://preview.supabase.co");
  });

  it("treats hostnames case-insensitively", async () => {
    const lookup = makeLookup();
    const result = await resolveInstance("ACME.Example.COM", {}, lookup);

    expect(result).toEqual(REGISTRY.acme);
    expect(lookup).toHaveBeenCalledWith("acme");

    const preview = await resolveInstance(
      "AIMS-Git-Branch.Vercel.App",
      PREVIEW_ENV,
      lookup,
    );
    expect(preview?.supabaseUrl).toBe("https://preview.supabase.co");
  });

  it("returns null for a hostname the registry does not know", async () => {
    const lookup = makeLookup();

    expect(await resolveInstance("nobody.example.com", {}, lookup)).toBeNull();
    expect(lookup).toHaveBeenCalledWith("nobody");
  });

  it("returns null on the apex domain without asking the registry", async () => {
    const lookup = makeLookup();

    // The apex is the marketing site. No fallback database: it
    // resolves to nothing rather than to somebody else's data.
    expect(await resolveInstance("example.com", {}, lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("treats www on the apex as the apex, not an instance named www", async () => {
    const lookup = makeLookup();

    expect(await resolveInstance("www.example.com", {}, lookup)).toBeNull();
    expect(await resolveInstance("WWW.Example.com:443", {}, lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("ignores a www prefix in front of a real subdomain", async () => {
    const lookup = makeLookup();
    const result = await resolveInstance("www.acme.example.com", {}, lookup);

    // www.acme.example.com and acme.example.com are one instance.
    expect(result).toEqual(REGISTRY.acme);
    expect(lookup).toHaveBeenCalledWith("acme");
    expect(lookup).toHaveBeenCalledTimes(1);

    expect(
      await resolveInstance("WWW.Acme.Example.com:3200", {}, lookup),
    ).toEqual(REGISTRY.acme);
  });

  it("does not confuse a subdomain that merely starts with www", async () => {
    const lookup = makeLookup();

    // "wwwacme" is a whole label of its own, not a www prefix.
    await resolveInstance("wwwacme.example.com", {}, lookup);
    expect(lookup).toHaveBeenCalledWith("wwwacme");
  });

  it("returns null for a bare host with no domain under it", async () => {
    const lookup = makeLookup();

    expect(await resolveInstance("localhost:3200", {}, lookup)).toBeNull();
    expect(await resolveInstance("", {}, lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("returns a suspended instance as-is", async () => {
    // Suspension is the caller's decision. Swallowing it here would
    // look identical to an unknown hostname.
    const result = await resolveInstance(
      "dormant.example.com",
      {},
      makeLookup(),
    );

    expect(result).toEqual(REGISTRY.dormant);
    expect(result?.status).toBe("suspended");
  });
});
