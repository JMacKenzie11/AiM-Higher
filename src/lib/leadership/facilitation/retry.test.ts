import { describe, it, expect, vi, beforeEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

// The facilitation review's single retry.
//
// About one review in ten comes back with a rich narrative and no
// `dimensions` block — 3 of 29 on production. Not an error, not a
// refusal, not a timeout: a successful call that omitted a field the
// tool schema marks required. That is the one failure a second
// attempt actually fixes.
//
// WHY RETRYING HERE IS SAFE is a property of WHERE it sits, and no
// test in this file can show it: analyzeMeeting runs the facilitation
// pass before its first database write, so no commitments exist yet
// to duplicate even when Automated Commitment Tracking is on. What
// these tests can pin is that it retries once, stops at once, and
// that a second bad answer leaves the meeting with no review.

const usage = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/coach/usage", () => ({ logCoachTokenUsage: usage.log }));

function toolResponse(input: Record<string, unknown>) {
  return {
    content: [{ type: "tool_use", name: "record_facilitation_review", input }],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

// The production specimen: a real summary, no dimensions block.
const UNSCORED = {
  insufficient_transcript: false,
  executive_summary: "A warm, specific check-in and grounded updates.",
  strengths: [],
  growth_edges: [],
  experiments: [],
  fourws_audit: [],
  agenda_adherence: { score_out_of_5: 3, notes: "" },
  appreciation_moments: [],
  generative_questions: [],
  reframes: [],
};

const SCORED = {
  ...UNSCORED,
  overall: 7,
  dimensions: {
    rhythm: { score: 7, notes: "ran to the agenda" },
    accountability: { score: 6, notes: "owners named" },
    alignment: { score: 7, notes: "shared picture" },
    positive_framing: { score: 8, notes: "generous check-in" },
  },
};

function clientReturning(...inputs: Array<Record<string, unknown>>) {
  const create = vi.fn();
  for (const input of inputs) create.mockResolvedValueOnce(toolResponse(input));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const input = { transcript: "…", companyContextBlock: "…" };

beforeEach(() => vi.clearAllMocks());

describe("analyzeMeetingFacilitation retry", () => {
  it("does not retry when the first answer scored", async () => {
    const { analyzeMeetingFacilitation } = await import("./analyze");
    const { client, create } = clientReturning(SCORED);

    const review = await analyzeMeetingFacilitation(client, input);

    expect(review?.overall).toBe(7);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first answer scored nothing, and keeps the second", async () => {
    const { analyzeMeetingFacilitation } = await import("./analyze");
    const { client, create } = clientReturning(UNSCORED, SCORED);

    const review = await analyzeMeetingFacilitation(client, input);

    expect(create).toHaveBeenCalledTimes(2);
    expect(review?.overall).toBe(7);
  });

  it("gives up after the second, leaving the meeting with no review", async () => {
    // Exactly where this stood before the retry existed. The retry
    // can only improve the odds; it never makes things worse.
    const { analyzeMeetingFacilitation } = await import("./analyze");
    const { client, create } = clientReturning(UNSCORED, UNSCORED);

    const review = await analyzeMeetingFacilitation(client, input);

    expect(create).toHaveBeenCalledTimes(2);
    expect(review).toBeNull();
  });

  it("never retries more than once", async () => {
    // The cron runs on maxDuration 300 and each meeting is already
    // two model calls. A third on the failures is affordable; a loop
    // on a busy pass is not.
    const { analyzeMeetingFacilitation } = await import("./analyze");
    const { client, create } = clientReturning(UNSCORED, UNSCORED, SCORED);

    await analyzeMeetingFacilitation(client, input);

    expect(create).toHaveBeenCalledTimes(2);
  });

  it("tags the retry's token usage so it is not read as a double-charge", async () => {
    const { analyzeMeetingFacilitation } = await import("./analyze");
    const { client } = clientReturning(UNSCORED, SCORED);

    await analyzeMeetingFacilitation(client, input);

    const purposes = usage.log.mock.calls.map((c) => c[0].purpose);
    expect(purposes).toEqual(["facilitation", "facilitation_retry"]);
  });

  it("logs usage for a failed attempt too", async () => {
    // The call was made and the tokens were spent. A cost dashboard
    // that only sees successes under-reports the expensive case.
    const { analyzeMeetingFacilitation } = await import("./analyze");
    const { client } = clientReturning(UNSCORED, UNSCORED);

    await analyzeMeetingFacilitation(client, input);

    expect(usage.log).toHaveBeenCalledTimes(2);
  });
});
