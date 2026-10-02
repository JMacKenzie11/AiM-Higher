import { describe, it, expect } from "vitest";

import { refusalReason } from "./scrub-dev-secrets.ts";

// The refusal is the whole safety of this script: it deletes rows with
// a service-role key. So the cases that must refuse are tested first,
// and the one that must proceed is tested last.

const DEV = "https://devclone.supabase.co";

describe("refusalReason", () => {
  it("refuses when the dev url is production", () => {
    expect(
      refusalReason({
        LOCAL_INSTANCE_SUPABASE_URL: DEV,
        PROD_SUPABASE_URL: DEV,
      })
    ).toContain("PROD_SUPABASE_URL");
  });

  it("refuses when the dev url is the control plane", () => {
    expect(
      refusalReason({
        LOCAL_INSTANCE_SUPABASE_URL: DEV,
        CONTROL_PLANE_SUPABASE_URL: DEV,
      })
    ).toContain("CONTROL_PLANE_SUPABASE_URL");
  });

  it("refuses when the dev url is the legacy single-instance url", () => {
    expect(
      refusalReason({
        LOCAL_INSTANCE_SUPABASE_URL: DEV,
        NEXT_PUBLIC_SUPABASE_URL: DEV,
      })
    ).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  // The reason this compares refs and not URL strings: two spellings
  // of one project are one project, and a string compare says they are
  // two. seed:e2e's guard would let both of these through.
  it("refuses a trailing slash spelling of the same project", () => {
    expect(
      refusalReason({
        LOCAL_INSTANCE_SUPABASE_URL: DEV,
        PROD_SUPABASE_URL: `${DEV}/`,
      })
    ).toContain("REFUSING");
  });

  it("refuses an http spelling of the same project", () => {
    expect(
      refusalReason({
        LOCAL_INSTANCE_SUPABASE_URL: DEV,
        PROD_SUPABASE_URL: "http://devclone.supabase.co",
      })
    ).toContain("REFUSING");
  });

  it("reports an unset dev url rather than proceeding", () => {
    expect(refusalReason({ PROD_SUPABASE_URL: DEV })).toContain(
      "LOCAL_INSTANCE_SUPABASE_URL"
    );
  });

  it("allows the dev clone when it is nothing else", () => {
    expect(
      refusalReason({
        LOCAL_INSTANCE_SUPABASE_URL: DEV,
        PROD_SUPABASE_URL: "https://prodref.supabase.co",
        CONTROL_PLANE_SUPABASE_URL: "https://prodref.supabase.co",
        NEXT_PUBLIC_SUPABASE_URL: "https://prodref.supabase.co",
      })
    ).toBeNull();
  });
});

// The Vault key check (0257): dev must not hold production's key, and
// the script never handles the keys themselves, only fingerprints.
import { fingerprint, keyVerdict, newRootKey, parseArgs } from "./scrub-dev-secrets.ts";

describe("the Vault key check", () => {
  it("calls a matching key production's, and a different one dev's own", () => {
    expect(keyVerdict(fingerprint("a"), fingerprint("a"))).toBe("production's key");
    expect(keyVerdict(fingerprint("a"), fingerprint("b"))).toBe("own key");
  });

  it("says unknown rather than guessing when a key could not be read", () => {
    expect(keyVerdict(null, fingerprint("a"))).toBe("unknown");
    expect(keyVerdict(fingerprint("a"), null)).toBe("unknown");
  });

  it("makes a fresh 64-character hex key each time", () => {
    const a = newRootKey();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newRootKey()).not.toBe(a);
  });

  it("will not rotate on a dry run, and names an unknown argument", () => {
    expect(parseArgs(["--dry-run", "--rotate-key"])).toHaveProperty("error");
    expect(parseArgs(["--force"])).toEqual({ error: "Unknown argument --force. Options: --dry-run, --rotate-key." });
    expect(parseArgs(["--", "--rotate-key"])).toEqual({ dryRun: false, rotateKey: true });
  });
});
