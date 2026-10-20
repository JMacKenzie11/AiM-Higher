import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fillMeetingHeadlines, validateHeadlines, HEADLINE_FROM_TRANSCRIPT_MAX } from "./headlines";

// Headlines from a meeting's transcript (change 13): held to the
// company's own areas, and never written over a person.

describe("validateHeadlines", () => {
  const ids = ["fn-ops", "fn-sales"];

  it("keeps one update per listed area and drops the rest", () => {
    const out = validateHeadlines(
      {
        headlines: [
          { function_id: "fn-ops", body: "  Two crews finished the Hale job early.  " },
          { function_id: "fn-ops", body: "A second update for the same area." },
          { function_id: "fn-other-company", body: "Not on the list." },
          { function_id: "fn-sales", body: "   " },
          { function_id: 7, body: "Not an id." },
        ],
      },
      ids
    );
    expect(out).toEqual([{ function_id: "fn-ops", body: "Two crews finished the Hale job early." }]);
  });

  it("reads nothing from the wrong shape", () => {
    expect(validateHeadlines(null, ids)).toEqual([]);
    expect(validateHeadlines({ headlines: "fn-ops" }, ids)).toEqual([]);
  });

  it("cuts a long update at a sentence", () => {
    const sentence = "We closed the quote and the crew starts Monday. ";
    const body = sentence.repeat(60);
    const [h] = validateHeadlines({ headlines: [{ function_id: "fn-ops", body }] }, ids);
    expect(h.body.length).toBeLessThanOrEqual(HEADLINE_FROM_TRANSCRIPT_MAX);
    expect(h.body.endsWith("Monday.")).toBe(true);
  });
});

// A database that answers the week's read and records each write.
function fakeAdmin(existing: Array<{ function_id: string; body: string }>, failInsertFor: string[] = []) {
  const writes: Array<{ op: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  return {
    writes,
    from() {
      let op = "select";
      let payload: Record<string, unknown> = {};
      const filters: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.in = () => b;
      b.eq = (k: string, v: unknown) => {
        filters[k] = v;
        return b;
      };
      b.insert = (p: Record<string, unknown>) => {
        op = "insert";
        payload = p;
        return b;
      };
      b.update = (p: Record<string, unknown>) => {
        op = "update";
        payload = p;
        return b;
      };
      b.then = (res: (v: unknown) => unknown) => {
        if (op === "select") return Promise.resolve({ data: existing, error: null }).then(res);
        writes.push({ op, payload, filters });
        const fail = op === "insert" && failInsertFor.includes(payload.function_id as string);
        return Promise.resolve({ error: fail ? { message: "duplicate key" } : null }).then(res);
      };
      return b;
    },
  };
}

describe("fillMeetingHeadlines", () => {
  const input = (headlines: Array<{ function_id: string; body: string }>) => ({
    companyId: "co",
    meetingId: "m1",
    weekEnding: "2026-10-23",
    headlines,
  });

  it("fills an empty area and a cleared one, and leaves a written one alone", async () => {
    const admin = fakeAdmin([
      { function_id: "fn-typed", body: "Typed in the room." },
      { function_id: "fn-cleared", body: "" },
    ]);
    const n = await fillMeetingHeadlines(
      admin as never,
      input([
        { function_id: "fn-typed", body: "From the transcript." },
        { function_id: "fn-cleared", body: "From the transcript, cleared box." },
        { function_id: "fn-new", body: "From the transcript, no row yet." },
      ])
    );
    expect(n).toBe(2);
    expect(admin.writes.map((w) => [w.op, w.payload.function_id ?? w.filters.function_id])).toEqual([
      ["update", "fn-cleared"],
      ["insert", "fn-new"],
    ]);
    // The cleared box is only filled while it is still blank.
    expect(admin.writes[0].filters.body).toBe("");
    for (const w of admin.writes) expect(w.payload.source_meeting_id).toBe("m1");
    expect(admin.writes[1].payload).toMatchObject({ company_id: "co", week_ending: "2026-10-23" });
  });

  it("lets a headline written after the read stand", async () => {
    const admin = fakeAdmin([], ["fn-raced"]);
    const n = await fillMeetingHeadlines(admin as never, input([{ function_id: "fn-raced", body: "Late." }]));
    expect(n).toBe(0);
  });

  it("writes nothing for no headlines", async () => {
    const admin = fakeAdmin([]);
    expect(await fillMeetingHeadlines(admin as never, input([]))).toBe(0);
    expect(admin.writes).toEqual([]);
  });
});
