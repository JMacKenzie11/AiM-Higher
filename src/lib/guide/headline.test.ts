import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("server-only", () => ({}));

import {
  checkCard,
  generateInvitationCard,
  repeatedPhrases,
  HEADLINE_FALLBACK,
  INVITATION_FALLBACK,
} from "./headline";

// A client that answers with each string in turn and records what it
// was asked, so the retry's instruction can be read.
function stubClient(replies: string[]) {
  const asked: Anthropic.MessageParam[][] = [];
  const client = {
    messages: {
      create: vi.fn(async (req: { messages: Anthropic.MessageParam[] }) => {
        asked.push(req.messages);
        return { content: [{ type: "text", text: replies.shift() ?? "" }], stop_reason: "end_turn" };
      }),
    },
  } as unknown as Anthropic;
  return { client, asked };
}

// Centre North's real line (dev, 2026-09-08).
const TRANSCRIPT = "Brendon: We can, yeah, we can definitely do it.\nCarmen: you can just go to one document.";

const GOOD = {
  headline: "Brendon agreed to lead next week's meeting himself.",
  invitation: "What made saying yes so easy?",
  opener:
    "Jeff asked the team to run next week's meeting on their own. Brendon answered right away.\n\n" +
    '"We can, yeah, we can definitely do it."\n\n' +
    "That quick yes shows the team trusts its own systems and each other.\n\n" +
    "What helped Brendon feel ready to say yes so fast?",
};

const INPUT = {
  model: "test",
  meetingDate: "2026-09-08",
  companyName: "Centre North",
  analysisMarkdown: "Brendon will run next week's meeting.",
  transcript: TRANSCRIPT,
  championName: null,
  strengths: [],
  recentInvitations: ["Want to look at what made that work?"],
};

describe("checkCard", () => {
  it("passes the approved Centre North example", () => {
    expect(checkCard(GOOD, TRANSCRIPT, INPUT.recentInvitations)).toEqual({ headline: [], invitation: [], opener: [] });
  });

  // Jason, 2026-09-29: "Nobody took it personally" implies somebody might have.
  it("refuses a headline that implies the opposite was expected", () => {
    const f = checkCard(
      { ...GOOD, headline: "The team disagreed openly about pricing and nobody took it personally." },
      TRANSCRIPT,
      []
    );
    expect(f.headline.join()).toMatch(/"nobody", which implies the opposite/);
    expect(
      checkCard({ ...GOOD, headline: "The team debated pricing openly and kept it constructive." }, TRANSCRIPT, []).headline
    ).toEqual([]);
  });

  it("allows two lines of headline and one of invitation", () => {
    expect(checkCard({ ...GOOD, headline: "x".repeat(101) }, TRANSCRIPT, []).headline.join()).toMatch(/101 characters/);
    expect(checkCard({ ...GOOD, invitation: `${"x".repeat(45)}?` }, TRANSCRIPT, []).invitation.join()).toMatch(/46 characters/);
  });

  it("wants a different invitation from recent weeks", () => {
    const f = checkCard({ ...GOOD, invitation: "Want to look at what made that work?" }, TRANSCRIPT, INPUT.recentInvitations);
    expect(f.invitation).toEqual(["the invitation repeats a recent one"]);
  });

  // Jason, 2026-09-29: the Centre North draft said Jeff had a doctor's appointment.
  it("refuses a personal reason for somebody's absence, anywhere on the card", () => {
    const f = checkCard(
      { ...GOOD, opener: GOOD.opener.replace("on their own.", "on their own while he had a doctor's appointment.") },
      TRANSCRIPT,
      []
    );
    expect(f.opener.join()).toMatch(/"doctor's appointment", a personal reason/);
    // A clinic's own appointments are its work.
    expect(checkCard({ ...GOOD, headline: "The front desk rebooked every cancelled appointment." }, TRANSCRIPT, []).headline).toEqual([]);
  });

  it("wants exactly one quote, and one the transcript contains", () => {
    const none = checkCard({ ...GOOD, opener: GOOD.opener.replace(/"/g, "") }, TRANSCRIPT, []);
    expect(none.opener.join()).toMatch(/0 quotes/);
    const invented = checkCard({ ...GOOD, opener: GOOD.opener.replace("we can definitely do it", "we will absolutely nail this") }, TRANSCRIPT, []);
    expect(invented.opener.join()).toMatch(/invented quote/);
  });

  it("holds the opener to the reply rules, outside the quote", () => {
    // "not just" and "rather than" join this check with #358, which
    // adds them to the reply rules this reuses.
    const f = checkCard({ ...GOOD, opener: GOOD.opener.replace("trusts its own systems", "trusts the room and its systems") }, TRANSCRIPT, []);
    expect(f.opener.join()).toMatch(/the room \("[^"]*room/);
    // "we can" twice inside the quote is theirs.
    expect(checkCard(GOOD, TRANSCRIPT, []).opener).toEqual([]);
  });

  it("refuses 'you two' when the reader may be neither of them", () => {
    const f = checkCard({ ...GOOD, opener: GOOD.opener.replace("What helped Brendon", "What helped you two") }, TRANSCRIPT, []);
    expect(f.opener.join()).toMatch(/"you two"/);
  });
});

// Jason, 2026-09-29, on the Geo-Sci draft.
describe("repeatedPhrases", () => {
  it("finds the same phrase in two sentences in a row", () => {
    expect(
      repeatedPhrases(
        "Kyle pushed for the full picture of what customers experience. That gives the team a truer picture of what customers actually experience."
      )
    ).toContain("picture of what");
  });

  it("leaves filler and sentences further apart alone", () => {
    expect(repeatedPhrases("It is one of the best. The team saw it is one of the ways.")).toEqual([]);
    expect(repeatedPhrases("A clear pipeline view. Then something else. A clear pipeline view again.")).toEqual([]);
  });
});

describe("generateInvitationCard", () => {
  it("puts each part of the first message on its own line", async () => {
    const oneLine = { ...GOOD, opener: GOOD.opener.replace(/\n\n/g, "\n") };
    const { client } = stubClient([JSON.stringify({ moment: "m", ...oneLine })]);
    const card = await generateInvitationCard(client, INPUT);
    expect(card.opener!.split("\n\n")).toHaveLength(4);
    expect(card.opener!.split("\n\n")[1]).toBe('"We can, yeah, we can definitely do it."');
  });

  it("returns the three pieces when they pass", async () => {
    const { client, asked } = stubClient([JSON.stringify({ moment: "m", ...GOOD })]);
    expect(await generateInvitationCard(client, INPUT)).toEqual(GOOD);
    expect(asked).toHaveLength(1);
  });

  it("sends it back once, naming what was wrong", async () => {
    const bad = { ...GOOD, headline: "Nobody took it personally when pricing came up." };
    const { client, asked } = stubClient([JSON.stringify(bad), JSON.stringify(GOOD)]);
    expect(await generateInvitationCard(client, INPUT)).toEqual(GOOD);
    expect(asked[1][asked[1].length - 1].content as string).toMatch(/implies the opposite/);
  });

  it("tries up to three times, and uses the third when it is the clean one", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const bad = JSON.stringify({ ...GOOD, headline: "Nobody took it personally when pricing came up." });
    const { client, asked } = stubClient([bad, bad, JSON.stringify(GOOD)]);
    expect(await generateInvitationCard(client, INPUT)).toEqual(GOOD);
    expect(asked).toHaveLength(3);
    log.mockRestore();
  });

  it("never stores a headline still wrong after three tries: the plain card, all three", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const bad = JSON.stringify({ ...GOOD, headline: "Nobody took it personally when pricing came up." });
    const { client, asked } = stubClient([bad, bad, bad]);
    expect(await generateInvitationCard(client, INPUT)).toEqual({
      headline: HEADLINE_FALLBACK("2026-09-08"),
      invitation: INVITATION_FALLBACK,
      opener: null,
    });
    expect(asked).toHaveLength(3);
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/headline still breaking the rules after three tries/);
    err.mockRestore();
    log.mockRestore();
  });

  it("never stores an invitation still wrong after three tries", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const bad = JSON.stringify({ ...GOOD, invitation: "Want to look at what made that work?" });
    const { client } = stubClient([bad, bad, bad]);
    expect(await generateInvitationCard(client, INPUT)).toEqual({ ...GOOD, invitation: INVITATION_FALLBACK });
    err.mockRestore();
    log.mockRestore();
  });

  it("drops only the opener when only the opener is still wrong", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const bad = JSON.stringify({ ...GOOD, opener: GOOD.opener.replace(/"/g, "") });
    const { client } = stubClient([bad, bad, bad]);
    expect(await generateInvitationCard(client, INPUT)).toEqual({ ...GOOD, opener: null });
    err.mockRestore();
    log.mockRestore();
  });

  it("sends the plain card when the reply is not JSON three times", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { client } = stubClient(["Sure! Here it is.", "", "no"]);
    expect((await generateInvitationCard(client, INPUT)).headline).toBe(HEADLINE_FALLBACK("2026-09-08"));
    err.mockRestore();
    log.mockRestore();
  });
});

describe("the plain card", () => {
  it("names the day in words and passes its own checks", () => {
    expect(HEADLINE_FALLBACK("2026-09-08")).toBe("The summary of your meeting on Tuesday Sep 8 is ready.");
    const plain = { headline: HEADLINE_FALLBACK("2026-09-08"), invitation: INVITATION_FALLBACK, opener: GOOD.opener };
    const f = checkCard(plain, TRANSCRIPT, []);
    expect(f.headline).toEqual([]);
    expect(f.invitation).toEqual([]);
  });
});
