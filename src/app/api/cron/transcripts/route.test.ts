import { describe, it, expect, beforeEach, vi } from "vitest";

// The cron endpoint executes ingestion + analysis (paid API calls,
// email sends). Anyone hitting the URL without the bearer secret
// must get a 401. This test locks that in.
//
// It also pins the route's response semantics now that the job fans
// out: a clean pass over every instance is a 200, and one instance
// failing is a 500, so a partial failure shows red in Vercel's cron
// history instead of being buried in a 200 body.
//
// We stub the registry, the Supabase admin client and the ingest
// module so this runs without a live DB.

const mocks = vi.hoisted(() => ({
  listActiveInstances: vi.fn(),
  ingestSource: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  withIsolationScope: <T>(fn: (scope: { setTag: () => void }) => T) =>
    fn({ setTag: () => {} }),
  captureException: () => {},
}));

vi.mock("@/lib/instances/registry", () => ({
  listActiveInstances: mocks.listActiveInstances,
  lookupInstance: async (subdomain: string) => ({
    subdomain,
    displayName: subdomain,
    supabaseUrl: `https://${subdomain}.supabase.co`,
    supabaseAnonKey: "anon",
    supabaseServiceKey: "service",
    status: "active",
  }),
}));

// One active transcript source per instance, so the route actually
// reaches ingestSource and a rejection there can be observed.
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: async () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({
          data: [{ id: "src-1", provider: "google_drive", scope: "shared" }],
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/transcripts/ingest", () => ({
  ingestSource: mocks.ingestSource,
  processPendingMeetings: async () => ({ processed: 0 }),
}));

const ONE_INSTANCE = [
  { subdomain: "acme", displayName: "Acme Industries", envPrefix: "ACME" },
];

describe("POST /api/cron/transcripts — auth", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "sekret";
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.listActiveInstances.mockResolvedValue(ONE_INSTANCE);
    mocks.ingestSource.mockResolvedValue({
      sourceId: "x",
      filesSeen: 0,
      filesIngested: 0,
      routedCount: 0,
      unroutedCount: 0,
    });
  });

  it("rejects requests without an Authorization header", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cron/transcripts", {
        method: "POST",
      }) as unknown as import("next/server").NextRequest
    );
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong bearer token", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cron/transcripts", {
        method: "POST",
        headers: { authorization: "Bearer nope" },
      }) as unknown as import("next/server").NextRequest
    );
    expect(res.status).toBe(401);
  });

  it("returns 500 when CRON_SECRET isn't configured", async () => {
    delete process.env.CRON_SECRET;
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cron/transcripts", {
        method: "POST",
      }) as unknown as import("next/server").NextRequest
    );
    expect(res.status).toBe(500);
  });

  it("accepts the correct bearer token", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/cron/transcripts", {
        method: "POST",
        headers: { authorization: "Bearer sekret" },
      }) as unknown as import("next/server").NextRequest
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/cron/transcripts — fan-out", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "sekret";
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.ingestSource.mockResolvedValue({
      sourceId: "x",
      filesSeen: 0,
      filesIngested: 0,
      routedCount: 0,
      unroutedCount: 0,
    });
  });

  async function run() {
    const { POST } = await import("./route");
    return POST(
      new Request("http://localhost/api/cron/transcripts", {
        method: "POST",
        headers: { authorization: "Bearer sekret" },
      }) as unknown as import("next/server").NextRequest
    );
  }

  it("returns 200 with the summary when every instance succeeds", async () => {
    mocks.listActiveInstances.mockResolvedValue([
      ...ONE_INSTANCE,
      { subdomain: "beta", displayName: "Beta Co", envPrefix: "BETA" },
    ]);

    const res = await run();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.lines).toContain(
      "[transcripts] 2 instances: 2 ok, 0 failed"
    );
  });

  it("returns 500 naming the instance when one fails", async () => {
    mocks.listActiveInstances.mockResolvedValue([
      ...ONE_INSTANCE,
      { subdomain: "beta", displayName: "Beta Co", envPrefix: "BETA" },
    ]);
    // The ingest of the first instance blows up; the second still runs.
    mocks.ingestSource.mockRejectedValueOnce(new Error("drive token expired"));

    const res = await run();
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.outcomes[0]).toMatchObject({
      subdomain: "acme",
      ok: false,
      error: "drive token expired",
    });
    expect(body.outcomes[1].ok).toBe(true);
  });

  it("returns 500 when the registry names no active instances", async () => {
    mocks.listActiveInstances.mockResolvedValue([]);

    const res = await run();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("no active instances");
  });
});
