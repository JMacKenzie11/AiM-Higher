import { describe, it, expect } from "vitest";
import { countTalk } from "./counts";

function line(who: string, words: number): string {
  return `${who}: ${Array.from({ length: words }, () => "word").join(" ")}`;
}

describe("countTalk", () => {
  it("shares talk by words and finds the biggest share", () => {
    const t = [line("A", 60), line("B", 30), line("C", 10)].join("\n");
    const c = countTalk(t);
    expect(c.speakers.map((s) => s.name)).toEqual(["A", "B", "C"]);
    expect(c.topShare).toBeCloseTo(0.6);
  });

  it("counts two labels for one person as one person", () => {
    const t = [line("Speaker 1", 40), line("Dana", 40), line("B", 20)].join("\n");
    const c = countTalk(t, { "Speaker 1": "Dana" });
    expect(c.speakers[0]).toMatchObject({ name: "Dana", words: 80, turns: 2 });
  });

  it("does not count a cough or a goodbye as an attendee", () => {
    const t = [line("A", 100), line("B", 100), line("Speaker 9", 3)].join("\n");
    expect(countTalk(t).attendees).toBe(2);
  });

  it("calls a person engaged only with enough turns and enough share", () => {
    const many = Array.from({ length: 5 }, () => [line("A", 40), line("B", 40)]).flat();
    const t = [...many, line("C", 30)].join("\n");
    const c = countTalk(t);
    expect(c.attendees).toBe(3);
    expect(c.engaged).toBe(2);
  });
});

describe("countTalk across transcript shapes", () => {
  it("reads Otter's header-then-words turns", () => {
    const t = "Speaker 1  00:01\nEverything recorded and going today.\n\nSpeaker 2  00:13\nOkay, that works here.\nAnd one more line.";
    const c = countTalk(t);
    expect(c.speakers.map((s) => [s.name, s.words])).toEqual([["Speaker 2", 8], ["Speaker 1", 5]]);
  });

  it("reads stamped turns after a notes tool's summary, and skips the summary", () => {
    const t = "Meeting: Weekly\r\nParticipants: Jeff, Chris\r\nTranscript\r\n(00:28) UNKNOWN_SPEAKER: Good afternoon all.\r\n(00:30) Jeff Bouwman: Afternoon, how is everyone doing?";
    const c = countTalk(t);
    expect(c.speakers.map((s) => s.name).sort()).toEqual(["Jeff Bouwman", "UNKNOWN_SPEAKER"]);
    expect(c.topShare).toBeCloseTo(5 / 8);
  });
});
