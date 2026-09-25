import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { VOICE_CORE } from "@/lib/voice/core";
import { stripEmDashes } from "@/lib/voice/strip-dashes";
import {
  findBannedPhrases,
  describeHits,
  retryInstruction,
} from "@/lib/voice/banned";
import {
  findUnsupportedQuotes,
  quoteRetryInstruction,
} from "@/lib/voice/quotes";

// THE NOTIFICATION LINE IS THE PRODUCT.
//
// It is the only thing the Guide says before a person chooses to
// engage, and it is the whole of the first impression. "Your meeting
// was analyzed" is a system message: it tells the champion something
// they could have guessed, and teaches them the notification is
// machinery rather than a person worth answering.
//
// What earns an open is one thing they could not see from inside the
// room, said warmly and briefly.
//
// ---- WHY THIS IS SAFE TO GENERATE IN A JOB ---------------------
//
// It reads the meeting ANALYSIS, which is company data written by
// the same pipeline under the same admin client. It never touches
// coach memory, which is person-scoped and unreachable without a
// session (0194). The conversation that follows does use memory, and
// that happens under the champion's own login.
//
// ---- IF IT FAILS -----------------------------------------------
//
// A plain fallback, and the nudge is still raised. A missing
// headline must never cost somebody the invitation.

export const HEADLINE_FALLBACK = (meetingDate: string) =>
  `Your leadership meeting from ${meetingDate} is ready to debrief with Aimee.`;

const SYSTEM = `You write the one line that invites a leader to debrief their weekly meeting with Aimee.

They were IN the meeting. They do not need a recap, and being told what happened reads as a machine reciting their own week back at them.

WHAT TO WRITE
- One thing worth their attention: something that worked, or a pattern visible from outside the meeting and not from inside it.
- Warm, specific, addressed to them. It should read as though somebody paid attention.
- End with a light invitation, written as a COMPLETE question: "Do you want to think about how to build on that?", "Is it worth five minutes to look at what made it work?". Never a fragment: not "Five minutes?", not "Worth a look?". An invitation, not an instruction.

Two that hit the target:
  "Tuesday's meeting showed a team that looks after its people. One thing you said about the branded boxes stuck with me. Five minutes?"
  "Nancy is teaching her picking technique without being asked. Want to think about how to build on that?"

HARD RULES
- Under 40 words.
- Never a recap of the agenda, never a count of issues or commitments, never a score or a grade, never "your meeting was analyzed".
- LEAD WITH THE STRENGTH. What the team did well comes first. A short context clause before it is fine ("When Dunleavy's credit came up, the team split the fault honestly"), as long as the line does not open on the problem. What they had been doing before goes second, or goes nowhere. "The team traced the collisions to the real cause and named an owner" opens correctly; "Three people assumed someone else owned the calendar" opens on the problem and is wrong, even when the sentence recovers later. The reader sees the opening words in a notification bar and may not read the rest.
- WHO DID IT. "You" only when the person reading did the thing themselves; you are told who they are. When somebody else did it, write "your team", or that person's name when the summary says who it was. "You traced the conflict to its root" sent to somebody who only agreed with the diagnosis credits them with a colleague's work.
- Quote only words the summary itself puts in quotation marks. If you need a contrast, describe it in your own words. Never invent the other half of one and put it in somebody's mouth.
- Name only people on the leadership team. Somebody on the floor may be described by what they did, such as "a supervisor" or "one of the pickers", but a person who was not at the meeting does not get named in a notification others may later see.
- No promises. You cannot remind, schedule or follow up in this phase.
- Plain sentences.

${VOICE_CORE}`;

// The prompt's limit. sanitiseHeadline's own ceiling is 45, a
// margin for the retry, never a target.
const HEADLINE_MAX_WORDS = 40;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Exported for the shared voice test, which holds every generated
// surface against the same handful of rules. Not for runtime use.
export const HEADLINE_RULES_FOR_TEST = SYSTEM;

export async function generateHeadline(
  client: Anthropic,
  input: {
    model: string;
    meetingDate: string;
    companyName: string;
    analysisMarkdown: string;
    // What was actually said. Quotes are checked against this, never
    // shown to the model: a summary can put its own paraphrase in
    // quotation marks, so "it is in the summary" proved nothing.
    transcript: string;
    // Who "you" is. Without it the model cannot follow the rule
    // about crediting the right person.
    championName: string | null;
    strengths: string[];
  }
): Promise<string> {
  const fallback = HEADLINE_FALLBACK(input.meetingDate);
  try {
    const strengths =
      input.strengths.length > 0
        ? `\n\nWhat the facilitation review noticed went well:\n${input.strengths
            .map((s) => `- ${s}`)
            .join("\n")}`
        : "";
    const userTurn =
      `Company: ${input.companyName}\nMeeting date: ${input.meetingDate}` +
      `\nWritten to: ${input.championName ?? "the company's AiMS champion (name unknown)"}` +
      `${strengths}\n\n<analysis>\n${input.analysisMarkdown.slice(0, 12000)}\n</analysis>`;

    const ask = async (
      messages: Anthropic.MessageParam[]
    ): Promise<string> => {
      const response = await client.messages.create({
        model: input.model,
        // Writing one sentence from material already in front of it.
        // Thinking consumed the entire budget and emitted nothing on
        // the analysis call; see the note in analyze.ts.
        thinking: { type: "disabled" },
        max_tokens: 300,
        system: [{ type: "text", text: SYSTEM }],
        messages,
      });
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    };

    let text = await ask([{ role: "user", content: userTurn }]);

    // ---- ONE RETRY, NAMING WHAT WAS WRONG -----------------------
    //
    // The rules are in the prompt and the model breaks them anyway,
    // in small habitual ways. Asking again with the offending
    // phrases quoted back fixes most of it, and one retry is where
    // this stops: a loop would spend a client's money arguing about
    // a notification, and the fallback headline is a perfectly
    // serviceable outcome.
    //
    // Cheap here in a way it is not everywhere. This runs in a
    // background job, writes 40 words, and nobody is waiting on a
    // screen for it.
    // Both checks, one retry. An invented quote is the more serious
    // of the two: a banned word is a tic, and a quote nobody said
    // is the product handing somebody a false record of their own
    // meeting. Named first in the retry for that reason.
    //
    // LENGTH is one of the checks. It was not: a 46-word headline
    // went straight to sanitiseHeadline, which refuses anything over
    // 45, and the champion got the fallback line with nothing in the
    // log. A line four words too long wants to be asked for again,
    // not thrown away.
    const hits = findBannedPhrases(text);
    const invented = findUnsupportedQuotes(text, input.transcript);
    const words = wordCount(text);
    const tooLong = words >= HEADLINE_MAX_WORDS;
    if (hits.length > 0 || invented.length > 0 || tooLong) {
      console.log(
        `[guide] headline retry:` +
          `${invented.length > 0 ? ` invented quote(s) ${invented.map((q) => `"${q.quote}"`).join(", ")};` : ""}` +
          `${tooLong ? ` ${words} words;` : ""}` +
          `${hits.length > 0 ? ` ${describeHits(hits)}` : ""}`
      );
      const instruction = [
        invented.length > 0 ? quoteRetryInstruction(invented) : null,
        tooLong
          ? `Your line is ${words} words. Write it again in under ${HEADLINE_MAX_WORDS} words, keeping the same point.`
          : null,
        hits.length > 0 ? retryInstruction(hits) : null,
      ]
        .filter(Boolean)
        .join(" ");
      text = await ask([
        { role: "user", content: userTurn },
        { role: "assistant", content: text },
        { role: "user", content: instruction },
      ]);
      const stillWrong = [
        ...findBannedPhrases(text),
        ...(wordCount(text) >= HEADLINE_MAX_WORDS
          ? [{ phrase: `${wordCount(text)} words`, context: text }]
          : []),
        ...findUnsupportedQuotes(text, input.transcript).map((q) => ({
          phrase: `invented quote "${q.quote}"`,
          context: q.quote,
        })),
      ];
      if (stillWrong.length > 0) {
        // Twice is a signal about the prompt, not about this
        // meeting. Said loudly so it is visible in the logs rather
        // than only in what a champion reads.
        console.error(
          `[guide] headline still breaking the rules after a retry: ${describeHits(stillWrong)}`
        );
      }
    }

    const clean = sanitiseHeadline(text);
    if (clean === null) {
      // Said out loud. The fallback is a serviceable line, and a
      // champion getting it every week is a failure that looks like
      // success unless somebody can see why.
      console.error(
        `[guide] headline refused by the final check, sending the fallback: "${text}"`
      );
      return fallback;
    }
    return clean;
  } catch (err) {
    console.error(
      "[guide] headline generation failed:",
      err instanceof Error ? err.message : err
    );
    return fallback;
  }
}

// The rules that CAN be checked are checked, rather than trusted to
// the prompt. A headline is read before anybody has chosen to
// engage, so one that goes out wrong costs more than one that never
// goes out.
export function sanitiseHeadline(raw: string): string | null {
  const withoutDashes = raw
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    // Em dashes read as machine-written in a line meant to sound
    // like a person. The shared pass, so a headline and a summary
    // resolve the same dash the same way; this one also caught the
    // en dash and the no-space form, which the local version here
    // did not.
    .replace(/\s+/g, " ");
  const text = stripEmDashes(withoutDashes);
  if (text.length < 15) return null;
  if (text.split(/\s+/).length > 45) return null;
  // The banned opening. A model told not to recap still sometimes
  // does, and this is the phrasing that makes the whole feature read
  // as machinery.
  if (/\b(your|the)\s+meeting\s+(was|has been)\s+analy[sz]ed/i.test(text)) {
    return null;
  }
  return text;
}
