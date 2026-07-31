import { describe, it, expect, beforeEach, vi } from "vitest";

// The cron endpoint executes ingestion + analysis (paid API calls,
// email sends). Anyone hitting the URL without the bearer secret
// must get a 401. This test locks that in.
//
// We stub the Supabase admin client + ingest module so the auth
// check runs in isolation without a live DB.

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [] }),
      }),
    }),
  }),
}));

vi.mock("@/lib/transcripts/ingest", () => ({
  ingestSource: async () => ({
    sourceId: "x",
    filesSeen: 0,
    filesIngested: 0,
    routedCount: 0,
    unroutedCount: 0,
  }),
  processPendingMeetings: async () => ({ processed: 0 }),
}));

describe("POST /api/cron/transcripts — auth", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "sekret";
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
