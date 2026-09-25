import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("server-only", () => ({}));

import { generateHeadline, HEADLINE_FALLBACK } from "./headline";

// A client that answers with each string in turn and records what it
// was asked, so the retry's instruction can be read.
function stubClient(replies: string[]) {
  const asked: Anthropic.MessageParam[][] = [];
  const client = {
    messages: {
      create: vi.fn(async (req: { messages: Anthropic.MessageParam[] }) => {
        asked.push(req.messages);
        return {
          content: [{ type: "text", text: replies.shift() ?? "" }],
          stop_reason: "end_turn",
        };
      }),
    },
  } as unknown as Anthropic;
  return { client, asked };
}

const INPUT = {
  model: "test",
  meetingDate: "2026-09-25",
  companyName: "E2E Fixture Co",
  analysisMarkdown: "Nobody owned the calendar.",
  transcript: "Speaker 2: Honestly? Nobody owns the calendar.",
  championName: "E2E Team Member",
  strengths: [],
};

// The real one: 46 words, refused by sanitiseHeadline's ceiling of
// 45, and the champion got the fallback with nothing in the log.
const FORTY_SIX =
  "Your team traced the Tuesday scheduling conflict past the schedule itself and found nobody actually owned the calendar. Naming that gap out loud, three weeks in, is what let it finally get fixed. Is it worth five minutes to look at how that thinking took hold?";
const SHORTER =
  "Your team traced three weeks of Tuesday conflicts to a calendar nobody owned. Is it worth five minutes to look at what made that work?";

describe("generateHeadline", () => {
  it("asks again when the line is too long, instead of falling back", async () => {
    const { client, asked } = stubClient([FORTY_SIX, SHORTER]);
    expect(await generateHeadline(client, INPUT)).toBe(SHORTER);
    const retry = asked[1][asked[1].length - 1].content as string;
    expect(retry).toContain("46 words");
  });

  it("says why when it does fall back", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = stubClient([FORTY_SIX, FORTY_SIX]);
    expect(await generateHeadline(client, INPUT)).toBe(HEADLINE_FALLBACK("2026-09-25"));
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(
      /still breaking the rules after a retry, sending the fallback: "46 words"/
    );
    err.mockRestore();
  });

  it("sends the plain line, not the broken one, when the retry breaks the rules too", async () => {
    // It used to send the second line anyway: a banned phrase or an
    // invented quote reached the champion whenever the retry failed
    // as well (audit, 2026-09-25).
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken =
      "Your team read the room well on the calendar question. Is it worth five minutes to look at what made that work?";
    const { client } = stubClient([broken, broken]);
    expect(await generateHeadline(client, INPUT)).toBe(HEADLINE_FALLBACK("2026-09-25"));
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/the room/);
    err.mockRestore();
  });

  it("checks quotes against the transcript, not the summary", async () => {
    // In the summary, never said.
    const { client, asked } = stubClient([
      'It came down to "nobody owned the calendar" this week. Is it worth five minutes to look at it?',
      SHORTER,
    ]);
    await generateHeadline(client, INPUT);
    expect(asked).toHaveLength(2);
    expect(asked[1][asked[1].length - 1].content as string).toContain(
      "not in the meeting transcript"
    );
  });
});
