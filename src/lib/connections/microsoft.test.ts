import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/supabase/env", () => ({ APP_URL: () => "https://www.aims-hq.com" }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: vi.fn() }));

describe("Microsoft sign-in links", () => {
  beforeEach(() => {
    vi.stubEnv("MICROSOFT_CLIENT_ID", "11111111-2222-3333-4444-555555555555");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "s3cret~value");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("asks a work account for exactly the permissions registered in Entra, and returns to this instance", async () => {
    const { buildMicrosoftConsentUrl } = await import("./microsoft");
    const url = new URL(buildMicrosoftConsentUrl("nonce.co1"));

    // Any work or school account; never a personal one.
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe("https://www.aims-hq.com/api/oauth/microsoft/callback");
    expect(url.searchParams.get("state")).toBe("nonce.co1");
    // The app registration lists these eight, delegated. A scope asked
    // for here and missing there fails every sign-in.
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "email",
      "profile",
      "offline_access",
      "https://graph.microsoft.com/User.Read",
      "https://graph.microsoft.com/Calendars.Read",
      "https://graph.microsoft.com/OnlineMeetings.Read",
      "https://graph.microsoft.com/OnlineMeetingTranscript.Read.All",
    ]);
    // The client secret never travels in a browser URL.
    expect(url.toString()).not.toContain("s3cret");
  });

  it("gives the client's admin an approval link that comes back to the callback's admin branch", async () => {
    const { adminConsentUrl } = await import("./microsoft");
    const url = new URL(adminConsentUrl());

    expect(url.pathname).toBe("/organizations/v2.0/adminconsent");
    expect(url.searchParams.get("state")).toBe("admin-consent");
    expect(url.searchParams.get("redirect_uri")).toBe("https://www.aims-hq.com/api/oauth/microsoft/callback");
  });

  it("is hidden until both keys are set", async () => {
    const { microsoftConfigured } = await import("./microsoft");
    expect(microsoftConfigured()).toBe(true);
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "");
    expect(microsoftConfigured()).toBe(false);
  });

  it("recognises Microsoft's 'your admin must approve' answers", async () => {
    const { needsAdminApproval } = await import("./microsoft");
    expect(needsAdminApproval("AADSTS65001: The user or administrator has not consented")).toBe(true);
    expect(needsAdminApproval("AADSTS90094: Admin approval required")).toBe(true);
    expect(needsAdminApproval("AADSTS7000215: Invalid client secret provided")).toBe(false);
  });
});

describe("graphRequest errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports Graph's inner error code, which is where the specific reason sits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { code: "Forbidden", message: "Denied", innerError: { code: "SpeakerAttributionNotAllowed" } } }),
          { status: 403 }
        )
      )
    );
    const { graphRequest, GraphError } = await import("./microsoft");
    const err = await graphRequest("t", "/me").catch((e) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect(err.code).toBe("SpeakerAttributionNotAllowed");
  });

  it("falls back to the top-level code when there is no inner one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: "SpeakerAttributionNotAllowed", message: "x" } }), { status: 403 }))
    );
    const { graphRequest } = await import("./microsoft");
    const err = await graphRequest("t", "/me").catch((e) => e);
    expect(err.code).toBe("SpeakerAttributionNotAllowed");
  });
});
