import { describe, it, expect } from "vitest";
import { checkVoice, COUNTED, SENT_BACK } from "./voice-check";

const counted = (text: string, userText = "") => checkVoice(text, COUNTED, { userText }).rules;
const firstReply = (text: string, skippedStrength: string | null = null) =>
  checkVoice(text, SENT_BACK["first reply"], { skippedStrength });

// The fixture meeting's real lines (scripts/fixtures/leadership-meeting.txt).
const TRANSCRIPT =
  "Speaker 1: Is it ours?\n\nSpeaker 2: Partly. About half of it is genuinely on us.\n\n" +
  "Speaker 2: I want it to stop happening, so yes.";

// Jason's dev debrief, 2026-09-28, the first reply after "Sure".
const REAL_DEBRIEF =
  'That instinct, splitting the credit fifty-fifty instead of arguing it to zero or caving to the whole amount, came straight from someone cutting to "is it ours" before anyone talked numbers. ' +
  'That\'s a different starting question than "how much do they want" or "how do we make this go away." ' +
  "You were in the room for that.";

describe("the first reply of a plain conversation (2026-09-29/30 test replies)", () => {
  it("catches her name at the start, and leaves it alone anywhere else", () => {
    for (const reply of [
      "I'm Aimee, the AiMS Leadership Coach. Happy to work through this with you. What's going on?",
      "I’m Aimee, the AiMS Leadership Coach. Happy to help.",
      "Hi, I'm Aimee. What's been happening?",
      "I am Aimee, and I can help with that.",
    ]) {
      expect(firstReply(reply).rules, reply).toContain("introduced herself");
    }
    expect(counted("You can ask Aimee on the page too.")).toEqual([]);
  });

  it("catches an opening That's or Okay, and actually in the question", () => {
    expect(firstReply("That's a jolt to get, especially if it came without much warning. What's been happening with them lately?").rules).toContain("started with That's");
    expect(firstReply("Okay, that's a tough one to watch play out in real time. What's been happening between them?").rules).toContain("started with Okay");
    expect(firstReply('What does "terrible at paperwork" actually look like week to week?').rules).toContain("actually in the question");
    expect(firstReply("It actually helps that you caught it early. What have you found so far?").rules).toEqual([]);
    expect(firstReply("Being sharp on the numbers is worth a lot. What's that like for the team?").rules).toEqual([]);
  });

  it("catches two asks, joined or separate", () => {
    for (const reply of [
      "That's a real problem to have surfaced. What have you found out so far, and how long has this been going on?",
      "Three weeks in is worth a look. What's been happening, is it that tasks are stalled, or is it not clear what's left to finish?",
      "That's a tough thing to hear. What's been going on with them lately, or what did they say when they brought it up?",
      "Okay. What happened? How did you find out?",
      "You're carrying two pieces of the margin picture now. How's the margin model coming, and did the supplier pricing data you need show up?",
    ]) {
      expect(firstReply(reply).rules, reply).toContain("more than one question");
    }
    expect(firstReply("How did you and Ray split it?").rules).toEqual([]);
    expect(firstReply("What would it take to finish the model and send it?").rules).toEqual([]);
  });

  it("catches rather than (split too) and not just, outside quotes", () => {
    expect(firstReply("He'd rather carry it himself than hand it off. What does that look like day to day?").rules).toEqual(["rather than"]);
    expect(firstReply("Rather a lot is riding on this. What's been happening?").rules).toEqual([]);
    expect(firstReply("Doing it instead of delegating costs time. What's been happening?").rules).toEqual(["X instead of Y"]);
    expect(firstReply("It's the paperwork, not just the deadlines. What's been happening?").rules).toEqual(["not just"]);
    expect(firstReply('You said "not just the deadlines". What else is going on?').rules).toEqual([]);
  });

  it("names a skipped strength", () => {
    const c = firstReply("What's been happening with the paperwork?", "great with the crew");
    expect(c.rules).toEqual(["skipped a named strength"]);
    expect(c.retry).toMatch(/"great with the crew"\)\. Acknowledge it first/);
  });

  it("passes the replies that got it right", () => {
    for (const reply of [
      "Let's look at it. What's been happening between them?",
      "Three weeks in and still stuck in onboarding is worth a second look. What's holding it up?",
      "Two of your people going at it where everyone can see it puts you in a tough spot.\n\nWhat's been happening between them?",
      'They said "is anybody using these, and why?" What made that question stick for you?',
    ]) {
      expect(firstReply(reply).rules, reply).toEqual([]);
    }
  });
});

describe("a generated opener", () => {
  it("finds the banned phrases in a real one", () => {
    const c = checkVoice(
      "Third week running for that Tuesday collision, and this time it stopped at the real gap instead of another patch. You were in the room for that one.",
      SENT_BACK.opener
    );
    expect(c.rules).toEqual(expect.arrayContaining(["the room", "X instead of Y"]));
  });

  it("passes a clean one", () => {
    expect(checkVoice("Your team agreed the crew would hear about the credit. Who tells the crew?", SENT_BACK.opener).rules).toEqual([]);
  });
});

describe("a debrief reply", () => {
  it("finds every fault in the real reply, invented quotes first, and passes its real quote", () => {
    const c = checkVoice(REAL_DEBRIEF, SENT_BACK["debrief reply"], { transcript: TRANSCRIPT });
    expect(c.faults[0]).toEqual({ rule: "invented quote", found: ["how much do they want", "how do we make this go away."] });
    expect(c.rules).toEqual(expect.arrayContaining(["the room", "X instead of Y"]));
    expect(c.retry.startsWith('You quoted "how much do they want"')).toBe(true);
  });

  it("catches affirming by denial", () => {
    expect(checkVoice("Nobody had a bad intent here, and that's how a gap survives.", SENT_BACK["debrief reply"]).faults).toEqual([
      { rule: "affirming by denial", found: ["Nobody had a bad intent here, and that's how a gap survives"] },
    ]);
    expect(checkVoice("This isn't about blame.", SENT_BACK["debrief reply"]).rules).toEqual(["affirming by denial"]);
  });

  it("skips the quote check when the transcript could not be read", () => {
    expect(checkVoice('"how much do they want"', SENT_BACK["debrief reply"], { transcript: "" }).rules).toEqual([]);
  });
});

// The three rules the principles comparison added (2026-10-02). Real
// replies from that run. Counted, not sent back.
describe("the principles rules", () => {
  it("catches grading what they said, decided or asked", () => {
    for (const reply of [
      "Good move. Taking it back to the team means they get to name what made it work.",
      "That's a solid move, taking it straight back to them.",
      "That's a clean move, taking it straight back to the people who made it happen.",
      "Good place to look, since people usually own what they help create.",
      "Good thing to be asking before it costs you a quarter.",
      "Bringing it back to the team is exactly the kind of move that turns one good meeting into a repeatable one.",
      "Both of those matter, and you're right to weigh them against each other.",
    ]) {
      expect(counted(reply), reply).toContain("graded them");
    }
  });

  it("leaves acknowledgements, strengths and questions alone", () => {
    for (const reply of [
      "That's a hard thing to watch happen. What's been going on with them lately?",
      "Good with the crew counts for a lot. What happens with the paperwork?",
      "Is that the right call for the crew?",
      "The meeting went well. What made it work?",
    ]) {
      expect(counted(reply), reply).not.toContain("graded them");
    }
  });

  it("catches a question that offers a choice or a list", () => {
    for (const reply of [
      "What's your read on where the margin is leaking: materials, labor hours, rework, or something else?",
      "Do you want to shape how you'll ask it, or is Monday's version already clear in your head?",
      "What's the team lead going to be responsible for day to day, the work itself or the crew?",
    ]) {
      expect(counted(reply), reply).toContain("a choice question");
    }
    for (const reply of [
      "Is it one or two jobs dragging the average down?",
      "Whether or not it works, what would you learn?",
      'You said "do it now or never". What made it feel that urgent?',
      "Rework or not, the crew stayed late. What made them stay?",
    ]) {
      expect(counted(reply), reply).not.toContain("a choice question");
    }
  });

  it("catches announcing the next move", () => {
    expect(counted("Before we get into the script, I want to name this plainly: roof shortcuts put the crew at risk.")).toContain("announced the next move");
    expect(counted("Let's work through it together. What's been happening with them?")).not.toContain("announced the next move");
  });
});

describe("every reply, counted", () => {
  it("names each rule once, from Aimee's own words", () => {
    expect(counted("Read the room. The room agreed, instead of arguing it out.").sort()).toEqual(["X instead of Y", "the room"]);
    expect(counted('Carmen said "one document instead of all these files". Who owns it?')).toEqual([]);
    expect(counted('You said "rather than argue, we move on". What made that the habit?')).toEqual([]);
  });

  it("counts a stock phrase in the first sentence only", () => {
    expect(counted("Bringing in the most revenue is real, and worth protecting. What happens when she works with ops?")).toContain("stock opening: is real");
    expect(counted("Let's look at it. What makes the progress feel real to you?")).toEqual([]);
  });

  it("counts their harsh word said back, quoted or not, and only theirs", () => {
    const theirs = "My top salesperson brings in the most revenue but she's awful to the ops team";
    expect(counted('Bringing in the most revenue takes skill. What does "awful to the ops team" look like when it happens?', theirs)).toContain("repeated their harsh word");
    expect(counted("Bringing in the most revenue takes skill. What happens when she works with ops?", theirs)).toEqual([]);
    expect(counted("That sounds terrible to sit through. What happened?", "The meeting ran long")).toEqual([]);
  });

  it("keeps every rule a held-back turn is sent back for", () => {
    for (const rules of Object.values(SENT_BACK)) for (const rule of rules) expect(COUNTED).toContain(rule);
  });
});

describe("the retry", () => {
  it("asks for a replacement, never a correction to answer", () => {
    const c = firstReply("I'm Aimee. What happened, and when did it start?");
    expect(c.retry).toMatch(/leave it out/);
    expect(c.retry).toMatch(/Ask one open question/);
    expect(c.retry).toMatch(/never mention a previous version/);
  });

  it("says what is wrong with the words that broke it, for a model to read", () => {
    expect(checkVoice("Read the room.", SENT_BACK.opener).describe).toBe('the room ("Read the room.")');
  });
});
