import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The usage logger is fire-and-forget, which is right for the call it
// counts and wrong for the row itself: a refused insert used to vanish.
// supabase-js RETURNS a check violation as `error` rather than throwing
// it, so these tests shape the insert's return value, not a throw.

const insert = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: async () => ({
    from: () => ({ insert }),
  }),
}));
vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: () => ({}),
}));

import { logCoachTokenUsage, reportEmptyResult } from "./usage";

const USAGE = { input_tokens: 350, output_tokens: 400 };

describe("logCoachTokenUsage", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    insert.mockReset();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("a refused row is logged with its purpose and the database's error, and does not throw", async () => {
    insert.mockResolvedValue({
      data: null,
      error: {
        code: "23514",
        message:
          'new row for relation "coach_token_usage" violates check constraint "coach_token_usage_purpose_check"',
      },
    });
    await expect(
      logCoachTokenUsage({
        conversationId: null,
        companyId: null,
        purpose: "measure_critique",
        model: "claude-sonnet-5",
        usage: USAGE,
      })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0][0]);
    expect(line).toContain('"measure_critique"');
    expect(line).toContain("23514");
    expect(line).toContain("coach_token_usage_purpose_check");
  });

  it("a thrown failure is logged with its purpose and does not throw", async () => {
    insert.mockRejectedValue(new Error("network down"));
    await expect(
      logCoachTokenUsage({
        conversationId: null,
        companyId: null,
        purpose: "hq_brief",
        model: "claude-sonnet-5",
        usage: USAGE,
      })
    ).resolves.toBeUndefined();
    expect(String(errorSpy.mock.calls[0][0])).toContain('"hq_brief"');
  });

  it("an accepted row logs nothing", async () => {
    insert.mockResolvedValue({ data: null, error: null });
    await logCoachTokenUsage({
      conversationId: null,
      companyId: null,
      purpose: "commitment_clarity",
      model: "claude-sonnet-5",
      usage: USAGE,
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("names empty_result only when the call came back empty", async () => {
    insert.mockResolvedValue({ data: null, error: null });
    const base = {
      conversationId: null,
      companyId: null,
      purpose: "measure_target_check" as const,
      model: "claude-sonnet-5",
      usage: USAGE,
    };
    await logCoachTokenUsage(base);
    await logCoachTokenUsage({ ...base, emptyResult: true });
    expect(insert.mock.calls[0][0]).not.toHaveProperty("empty_result");
    expect(insert.mock.calls[1][0]).toMatchObject({
      purpose: "measure_target_check",
      empty_result: true,
    });
  });
});

describe("reportEmptyResult", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("is loud about no text, naming the feature, the stop reason and the tokens", () => {
    const empty = reportEmptyResult("hq_brief", "  \n", {
      stop_reason: "max_tokens",
      usage: { output_tokens: 800 },
    });
    expect(empty).toBe(true);
    const line = String(errorSpy.mock.calls[0][0]);
    expect(line).toContain("[hq_brief]");
    expect(line).toContain("stop_reason=max_tokens");
    expect(line).toContain("output_tokens=800");
  });

  it("is quiet when there is text", () => {
    expect(
      reportEmptyResult("hq_brief", "A brief.", { stop_reason: "end_turn" })
    ).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
