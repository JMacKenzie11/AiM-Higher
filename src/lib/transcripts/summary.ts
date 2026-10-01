import type Anthropic from "@anthropic-ai/sdk";
import { unquoteUnsupported } from "@/lib/voice/quotes";
import { type PersonalDetailMatcher } from "@/lib/voice/personal-detail";
import { rewordProse } from "./redact";
import type { Reword } from "./reword";
import { replaceSpeakerLabels, type SpeakerMap } from "./speakers";
import type { Speller, SpellingChange } from "./spelling";

// THE MEETING SUMMARY, FROM THE MODEL'S MESSAGE TO WHAT IS STORED.
//
// Every pass the summary goes through lives here, in order, so a
// retry goes through exactly the passes the first attempt did:
//
//   1. quotation marks come off any span the transcript lacks
//      (voice/quotes.ts);
//   2. speaker labels become names (speakers.ts);
//   3. the company's spellings are enforced (spelling.ts);
//   4. nothing about a person's private life (voice/personal-detail.ts):
//      each sentence that breaks it is sent back once to be reworded
//      (reword.ts), and only that sentence. A clean rewrite takes its
//      place; a sentence still breaking the rule is taken out. The
//      summary is never regenerated to fix a line: on 2026-10-01 a
//      full rewrite of a long Benson summary came back as a
//      328-character fragment and replaced 25,000 characters, and it
//      doubled the slowest call. The meeting always completes.
//
// Dashes are stripped at the write in analyze.ts, with everything
// else that is stored.

export type SummaryPasses = {
  transcript: string;
  speakerMap: SpeakerMap | null;
  spell: Speller;
  personalDetail: PersonalDetailMatcher;
};

type Attempt = {
  markdown: string;
  truncated: boolean;
  unquoted: string[];
  labelsReplaced: number;
  spellingChanges: SpellingChange[];
};

export type SettledSummary = Attempt & {
  // Counts only: what the sentences said is never logged or stored.
  personalDetail: { reworded: number; removed: number };
};

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function finish(message: Anthropic.Message, passes: SummaryPasses): Attempt {
  const raw = textOf(message);
  // QUOTATION MARKS MEAN THE EXACT WORDS. A summary quoted "who owns
  // the calendar", which nobody said, and the debrief opener quoted it
  // back to the champion as a record of their meeting. The words stay,
  // as the summary's own paraphrase.
  const { text: unquotedText, unquoted } = unquoteUnsupported(raw, passes.transcript);
  // After the quote pass, so a quote is compared with the transcript
  // exactly as the model wrote it.
  const { text: labelled, replaced } = replaceSpeakerLabels(unquotedText, passes.speakerMap);
  const { text, changes } = passes.spell(labelled);
  return {
    markdown: text,
    // Recorded from stop_reason, not guessed from the text: a summary
    // that legitimately ends on a bullet has no terminal punctuation.
    truncated: message.stop_reason === "max_tokens",
    unquoted,
    labelsReplaced: replaced,
    spellingChanges: changes,
  };
}

export async function settleSummary(
  message: Anthropic.Message,
  passes: SummaryPasses,
  reword: Reword
): Promise<SettledSummary> {
  const attempt = finish(message, passes);
  const { texts, reworded, removed } = await rewordProse([attempt.markdown], passes.personalDetail, reword);
  return { ...attempt, markdown: texts[0], personalDetail: { reworded, removed } };
}
