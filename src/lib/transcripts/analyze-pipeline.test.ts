import { describe, it, expect, vi, beforeEach } from "vitest";

// analyzeMeeting end to end, with the database and the model faked.
//
// What this pins is the ORDER of things, which no unit test of a
// piece can: the analysis, the extraction and the facilitation review
// are all in flight before any of them returns, and when one of the
// two load-bearing calls fails, the meeting is marked failed with
// nothing written: no analysis row, no commitment, no nudge.

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  create: vi.fn(),
  facilitation: vi.fn(),
  nudge: vi.fn(),
  track: vi.fn(),
  writes: [] as Array<{ table: string; op: string; payload?: unknown }>,
  features: [] as string[],
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: h.create };
  },
}));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/coach/usage", () => ({ logCoachTokenUsage: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ track: h.track }));
vi.mock("@/lib/guide/nudges", () => ({ raiseMeetingDebriefNudge: h.nudge }));
vi.mock("@/lib/leadership/facilitation/analyze", () => ({ analyzeMeetingFacilitation: h.facilitation }));
vi.mock("@/lib/leadership/questions", () => ({
  generateMeetingQuestions: vi.fn(async () => ({ nextWeek: [], opened: [] })),
}));
vi.mock("./coverage", () => ({ checkCoverage: vi.fn(async () => ({ missed: [], checked: 0 })) }));
vi.mock("./speakers", async (orig) => ({
  ...(await orig<typeof import("./speakers")>()),
  mapSpeakers: vi.fn(async () => null),
}));

// A query builder that answers by table, and records every write.
function fakeDb() {
  const meeting = {
    id: "m1",
    company_id: "c1",
    status: "pending",
    transcript_text: "Pat: I will send the quote on Friday.",
    created_at: "2026-09-22T15:00:00Z",
    file_name: "weekly.txt",
    meeting_title: "Weekly",
  };
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let op = "select";
      const b: Record<string, unknown> = {};
      for (const m of ["select", "neq", "in", "order", "limit", "gte"]) b[m] = () => b;
      b.eq = (k: string, v: unknown) => {
        filters[k] = v;
        return b;
      };
      for (const m of ["insert", "update", "delete"]) {
        b[m] = (payload?: unknown) => {
          op = m;
          h.writes.push({ table, op: m, payload });
          return b;
        };
      }
      const result = () => {
        if (op === "insert" && table === "commitments") return { data: [{ id: "c" }], error: null };
        if (op !== "select") return { data: null, error: null };
        if (table === "meetings") return { data: meeting, error: null };
        if (table === "companies") return { data: { name: "Fixture Co", timezone: "UTC" }, error: null };
        if (table === "company_features") {
          return { data: h.features.includes(filters.feature as string) ? { feature: filters.feature } : null, error: null };
        }
        if (table === "company_foundation" || table === "quarters") return { data: null, error: null };
        return { data: [], error: null };
      };
      b.maybeSingle = async () => result();
      b.single = async () => result();
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(res, rej);
      return b;
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: async () => fakeDb() }));

const SUMMARY = "## Attendees\n\n- Pat\n\n## Summary\n\nThe team agreed the quote goes out Friday.";
const EXTRACTION = JSON.stringify({ commitments: [], issues: [{ title: "Quote timing" }] });

const kindOf = (req: { system: Array<{ text: string }> }) =>
  req.system[0].text.startsWith("You extract commitments") ? "extraction" : "analysis";
const text = (t: string) => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: null });

beforeEach(() => {
  vi.clearAllMocks();
  h.writes.length = 0;
  h.features = ["meeting_facilitation_review"];
  process.env.ANTHROPIC_API_KEY = "test";
  h.nudge.mockResolvedValue({ raised: false, reason: "test" });
});

describe("analyzeMeeting runs its three calls at once", () => {
  it("starts the analysis, the extraction and the review before any of them returns", async () => {
    // Each call waits until all three have started. Run in sequence,
    // the first would wait forever, and the race below says so.
    const started = new Set<string>();
    let release!: () => void;
    const allStarted = new Promise<void>((r) => (release = r));
    const arrive = (k: string) => {
      started.add(k);
      if (started.size === 3) release();
      return allStarted;
    };
    h.create.mockImplementation(async (req) => {
      const k = kindOf(req);
      await arrive(k);
      return text(k === "analysis" ? SUMMARY : EXTRACTION);
    });
    h.facilitation.mockImplementation(async () => {
      await arrive("facilitation");
      return null;
    });

    const { analyzeMeeting } = await import("./analyze");
    const sequential = new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`only ${[...started].join(", ")} started: the calls ran one after another`)), 2000)
    );
    await Promise.race([analyzeMeeting("m1"), sequential]);

    expect([...started].sort()).toEqual(["analysis", "extraction", "facilitation"]);
    expect(h.writes.some((w) => w.table === "meeting_analyses" && w.op === "insert")).toBe(true);
  });
});

describe("one failing call fails the meeting cleanly", () => {
  for (const failing of ["extraction", "analysis"] as const) {
    it(`when the ${failing} fails: the meeting is marked failed and nothing is written`, async () => {
      h.features = ["meeting_facilitation_review", "automated_commitment_tracking"];
      h.create.mockImplementation(async (req) => {
        const k = kindOf(req);
        if (k === failing) throw new Error(`${failing} overloaded`);
        return text(k === "analysis" ? SUMMARY : EXTRACTION);
      });
      h.facilitation.mockResolvedValue(null);

      const { analyzeMeeting } = await import("./analyze");
      await expect(analyzeMeeting("m1")).rejects.toThrow(`${failing} overloaded`);

      const meetingUpdates = h.writes.filter((w) => w.table === "meetings" && w.op === "update");
      expect(meetingUpdates.at(-1)?.payload).toMatchObject({ status: "failed", error: `${failing} overloaded` });
      expect(h.writes.filter((w) => w.table === "meeting_analyses")).toEqual([]);
      expect(h.writes.filter((w) => w.table === "commitments")).toEqual([]);
      expect(h.nudge).not.toHaveBeenCalled();
      expect(h.track).not.toHaveBeenCalled();
    });
  }

  it("a failing review is not a failed meeting: it completes with no review", async () => {
    h.create.mockImplementation(async (req) => text(kindOf(req) === "analysis" ? SUMMARY : EXTRACTION));
    h.facilitation.mockRejectedValue(new Error("review overloaded"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const { analyzeMeeting } = await import("./analyze");
    await analyzeMeeting("m1");

    const insert = h.writes.find((w) => w.table === "meeting_analyses" && w.op === "insert");
    expect(insert?.payload).toMatchObject({ facilitation_review_json: null });
    expect(h.writes.filter((w) => w.table === "meetings" && w.op === "update").at(-1)?.payload).toMatchObject({
      status: "complete",
    });
    err.mockRestore();
  });
});
