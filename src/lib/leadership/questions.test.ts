import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  questionFaults,
  allFaults,
  generateMeetingQuestions,
  readOpened,
  unwrapRaw,
  personalFault,
} from "./questions";

// Real lines, from the Benson summary and the fixture summary.
const SUMMARY = `### A) Check-In

**Key Questions That Facilitated the Discussion**
- Darlene Clinch: "What about sanitation?" (surfaced a gap in the proposed dashboard)

**Decisions Made (Within This Topic)**
None.

### B) Staffing

**Key Questions That Facilitated the Discussion**
- An unidentified speaker: "Five persons a shift, or six or four?" (grounded the staffing conversation)
- Susan Benson: Are they coming printed or just the phone? (not in quotation marks, so not verified)
- Casey Benson, checking his own reasoning: "If people want to not bank hours but bank money for the next three or four weeks... do we even offer that?" (a possible benefit)
- "What's dragging it?" (E2E Company Admin, moving from the top-line number to root cause)
- Casey: asking whether the venue runs fixed hours.

## Decisions Made (Summary Section)
- "Not a question at all" (Casey Benson, a decision)`;

describe("questionFaults", () => {
  it("passes the target question", () => {
    expect(
      questionFaults(
        "Nancy's technique spread because she showed it to people. Where else on our floor is someone doing something well that nobody has watched yet?"
      )
    ).toEqual([]);
  });

  it("refuses diagnosis, length, a missing question mark and a banned phrase", () => {
    expect(questionFaults("Why hasn't the calendar had an owner until now?")).toContain(
      "opens as a diagnosis, not a possibility"
    );
    expect(questionFaults("What went wrong with the Tuesday schedule?")).toContain(
      "opens as a diagnosis, not a possibility"
    );
    expect(questionFaults(`${"word ".repeat(35)}?`)[0]).toMatch(/needs to be under 35/);
    expect(questionFaults("Where else could we try that")).toContain("does not end in a question mark");
    expect(questionFaults("What would it look like to unpack that together?").join(" ")).toMatch(/unpack/);
  });
});

function stub(...outputs: Array<Record<string, unknown>>) {
  const create = vi.fn();
  for (const o of outputs) {
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", id: "t", name: "record_questions", input: o }] });
  }
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const GOOD = [
  { moment: "Nancy showed her technique", question: "Nancy's technique spread because she showed it. Where else is someone doing something well that nobody has watched yet?" },
  { moment: "the shutdown plan", question: "The shutdown plan took care of both groups of workers. What would it look like to plan the next one that early?" },
  { moment: "Grand Manan booth", question: "Sharing a booth came up as a way to spread the cost. Where else could island businesses do more together?" },
];

describe("generateMeetingQuestions", () => {
  const base = {
    model: "m",
    analysisMarkdown: SUMMARY,
    strengths: [],
    transcript: "Speaker 1: I don't know if they know that Raw is getting that RTEs have any incentive stuff.",
    speakerBlock: "<speaker_map>- Speaker 1 = Casey Benson (high)</speaker_map>",
    attendees: ["Casey Benson", "Darlene Clinch"],
  };

  it("keeps good questions, and credits only identified attendees, by first name, with no quotation marks", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { client, create } = stub({
      questions: GOOD,
      opened: [
        {
          asker: "Casey Benson",
          asked: 'Casey asked "whether the Raw crew knows RTE has an incentive?"',
          opened: "Surfaced that the two crews never meet, so Raw may not know.",
        },
        { asker: "Darlene Clinch", asked: "whether anybody was actually using the scissors", opened: "Nobody was, so the scissors went" },
        // Not an identified attendee: dropped, never guessed.
        { asker: "Shawn Warman", asked: "how many to a shift", opened: "Grounded the staffing numbers." },
      ],
    });
    const out = await generateMeetingQuestions(client, base);
    expect(create).toHaveBeenCalledTimes(1);
    expect(out.nextWeek).toHaveLength(3);
    expect(out.opened).toEqual([
      {
        asker: "Casey",
        asked: "whether the Raw crew knows RTE has an incentive",
        opened: "Surfaced that the two crews never meet, so Raw may not know.",
      },
      { asker: "Darlene", asked: "whether anybody was actually using the scissors", opened: "Nobody was, so the scissors went." },
    ]);
    // The model reads the transcript and the speaker map to judge effect.
    const turn = create.mock.calls[0][0].messages[0].content as string;
    expect(turn).toContain("<transcript>");
    expect(turn).toContain("Casey Benson (high)");
    // Not the summary's recorded list: that pulled the pick toward form.
    expect(turn).not.toContain("Questions the summary recorded");
    log.mockRestore();
  });

  it("drops an opened line that breaks the voice rules", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(
      readOpened(
        { opened: [{ asker: "Casey Benson", asked: "whether we could unpack the pricing", opened: "It opened the pricing up." }] },
        ["Casey Benson"]
      )
    ).toEqual([]);
    log.mockRestore();
  });

  it("uses the full name when two attendees share a first name", () => {
    expect(
      readOpened(
        { opened: [{ asker: "Casey Benson", asked: "how buyers could come back directly", opened: "Set the inserts' real goal." }] },
        ["Casey Benson", "Casey Smith"]
      )[0].asker
    ).toBe("Casey Benson");
  });

  it("retries once naming the fault, then drops a question still wrong, and strips em dashes", async () => {
    const bad = [{ moment: "x", question: "Why hasn't anyone owned the calendar?" }, GOOD[1], GOOD[2]];
    const stillBad = [
      { moment: "x", question: "What went wrong with the calendar?" },
      { moment: "y", question: "The shutdown plan landed early — what made that possible for us?" },
      GOOD[2],
    ];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { client, create } = stub({ questions: bad, opened: [] }, { questions: stillBad, opened: [] });
    const out = await generateMeetingQuestions(client, base);
    expect(create).toHaveBeenCalledTimes(2);
    const retry = create.mock.calls[1][0].messages.at(-1).content as string;
    expect(retry).toContain("opens as a diagnosis");
    expect(out.nextWeek.map((q) => q.question)).toHaveLength(2);
    expect(out.nextWeek.every((q) => !q.question.includes("—"))).toBe(true);
    err.mockRestore();
    log.mockRestore();
  });
});

describe("allFaults", () => {
  it("holds the From line to the banned list as well", () => {
    // Real, from the Benson run on dev, 2026-09-25.
    expect(
      allFaults({
        question: "Where else on the floor could one person's technique become everyone's technique?",
        moment: "Darlene noticed scissors had quietly disappeared from the floor.",
      }).join(" ")
    ).toMatch(/From" line uses "quietly"/);
  });
});

describe("unwrapRaw", () => {
  it("unwraps an answer returned as a JSON string inside questions", () => {
    // The real shape from the Benson run on dev.
    const inner = { questions: [{ moment: "m", question: "q?" }], opened: [{ asker: "a", asked: "b", opened: "c" }] };
    expect(unwrapRaw({ questions: JSON.stringify(inner) })).toEqual(inner);
  });

  it("leaves a normal answer alone, and a non-JSON string finds nothing", () => {
    const normal = { questions: [], opened: [] };
    expect(unwrapRaw(normal)).toBe(normal);
    expect(unwrapRaw({ questions: "not json" })).toEqual({ questions: "not json" });
  });
});

describe("the retry's picks", () => {
  it("are used when the first answer had none", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { client } = stub(
      { questions: "garbage" },
      {
        questions: GOOD,
        opened: [{ asker: "Darlene Clinch", asked: "whether anybody was using the scissors", opened: "Nobody was, so they went" }],
      }
    );
    const out = await generateMeetingQuestions(client, {
      model: "m", analysisMarkdown: "", strengths: [], transcript: "", speakerBlock: "",
      attendees: ["Darlene Clinch"],
    });
    expect(out.nextWeek).toHaveLength(3);
    expect(out.opened.map((o) => o.asker)).toEqual(["Darlene"]);
    err.mockRestore();
    log.mockRestore();
  });
});

describe("a From line that breaks the rules after the retry", () => {
  it("is dropped, and its question kept", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const bad = { moment: "They chose technique instead of treating it as talent.", question: GOOD[0].question };
    const { client } = stub({ questions: [bad, GOOD[1], GOOD[2]], opened: [] }, { questions: [bad, GOOD[1], GOOD[2]], opened: [] });
    const out = await generateMeetingQuestions(client, {
      model: "m", analysisMarkdown: "", strengths: [], transcript: "", speakerBlock: "", attendees: [],
    });
    expect(out.nextWeek).toHaveLength(3);
    expect(out.nextWeek[0]).toEqual({ question: GOOD[0].question, moment: "" });
    log.mockRestore();
  });
});

describe("a pick that breaks the voice rules", () => {
  it("is named in the retry and the reworded pick is kept", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const bad = { asker: "Darlene Clinch", asked: "whether the stall could be shared instead of ours alone", opened: "Opened a partnership" };
    const good = { asker: "Darlene Clinch", asked: "whether the stall could be shared with other businesses", opened: "Opened a partnership" };
    const { client, create } = stub({ questions: GOOD, opened: [bad] }, { questions: GOOD, opened: [good] });
    const out = await generateMeetingQuestions(client, {
      model: "m", analysisMarkdown: "", strengths: [], transcript: "", speakerBlock: "", attendees: ["Darlene Clinch"],
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].messages.at(-1).content as string).toContain("Keep the pick and reword it");
    expect(out.opened).toEqual([
      { asker: "Darlene", asked: "whether the stall could be shared with other businesses", opened: "Opened a partnership." },
    ]);
    log.mockRestore();
  });
});

describe("nothing personal", () => {
  it("refuses the real production question", () => {
    expect(
      questionFaults(
        "Our check-in this week let real news like Darlene's hospital countdown come out naturally. What would it look like if we made room for that kind of unhurried sharing every meeting?"
      ).join(" ")
    ).toMatch(/personal or health detail \("hospital"\)/);
  });

  it("catches the plain words, and leaves work alone", () => {
    for (const t of ["her surgery next week", "on maternity leave", "a grandchild's birth", "covering for sick supervisors"]) {
      expect(personalFault(t)).not.toBeNull();
    }
    for (const t of ["the shutdown plan", "a healthy competition on the floor", "the operation ran smoothly", "a new baseline for sanitation"]) {
      expect(personalFault(t)).toBeNull();
    }
  });

  it("drops a From line that mentions one, and keeps the question", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const q = { question: GOOD[0].question, moment: "Right after Darlene shared her hospital news." };
    const { client } = stub({ questions: [q, GOOD[1], GOOD[2]], opened: [] }, { questions: [q, GOOD[1], GOOD[2]], opened: [] });
    const out = await generateMeetingQuestions(client, {
      model: "m", analysisMarkdown: "", strengths: [], transcript: "", speakerBlock: "", attendees: [],
    });
    expect(out.nextWeek[0]).toEqual({ question: GOOD[0].question, moment: "" });
    log.mockRestore();
  });

  it("drops a pick whose lines mention one", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(
      readOpened({ opened: [{ asker: "Casey Benson", asked: "how the surgery went", opened: "Opened a warm moment." }] }, ["Casey Benson"])
    ).toEqual([]);
    log.mockRestore();
  });
});

describe("the company's spellings", () => {
  it("reach the questions call", async () => {
    const { client, create } = stub({ questions: GOOD, opened: [] });
    await generateMeetingQuestions(client, {
      model: "m", analysisMarkdown: "", strengths: [], transcript: "", speakerBlock: "", attendees: [],
      companyBlock: "<company_context>Elmendale</company_context>",
    });
    expect(create.mock.calls[0][0].messages[0].content as string).toContain("<company_context>Elmendale</company_context>");
  });
});
