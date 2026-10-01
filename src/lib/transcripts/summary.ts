import type Anthropic from "@anthropic-ai/sdk";
import { unquoteUnsupported } from "@/lib/voice/quotes";
import {
  findPersonalDetail,
  personalDetailRetryInstruction,
  removePersonalDetail,
  type PersonalDetailMatcher,
} from "@/lib/voice/personal-detail";
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
//      a summary that breaks it is sent back once, naming the
//      sentences, and the attempt with fewer is kept; what is still
//      there after that is taken out, sentence by sentence. The
//      meeting always completes: the summary is what everything else
//      reads, and one removed sentence is a smaller loss than none.
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
  raw: string;
  markdown: string;
  truncated: boolean;
  unquoted: string[];
  labelsReplaced: number;
  spellingChanges: SpellingChange[];
};

export type SettledSummary = Omit<Attempt, "raw"> & {
  // Counts only: what the sentences said is never logged or stored.
  personalDetail: { found: number; retried: boolean; removed: number };
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
    raw,
    markdown: text,
    // Recorded from stop_reason, not guessed from the text: a summary
    // that legitimately ends on a bullet has no terminal punctuation.
    truncated: message.stop_reason === "max_tokens",
    unquoted,
    labelsReplaced: replaced,
    spellingChanges: changes,
  };
}

// `retry` sends the same request again with the first attempt and the
// instruction appended, and returns the model's new message.
export async function settleSummary(
  first: Anthropic.Message,
  passes: SummaryPasses,
  retry: (previous: string, instruction: string) => Promise<Anthropic.Message>
): Promise<SettledSummary> {
  let attempt = finish(first, passes);
  let personal = findPersonalDetail(attempt.markdown, passes.personalDetail);
  const found = personal.length;
  let retried = false;

  if (personal.length > 0) {
    retried = true;
    const second = finish(
      await retry(attempt.raw, personalDetailRetryInstruction(personal)),
      passes
    );
    const secondPersonal = findPersonalDetail(second.markdown, passes.personalDetail);
    // A rewrite cut off at the token limit is worse than a sentence
    // taken out of a complete summary.
    if (!second.truncated && secondPersonal.length < personal.length) {
      attempt = second;
      personal = secondPersonal;
    }
  }

  const { text: markdown, removed } =
    personal.length > 0
      ? removePersonalDetail(attempt.markdown, passes.personalDetail)
      : { text: attempt.markdown, removed: 0 };

  return {
    markdown,
    truncated: attempt.truncated,
    unquoted: attempt.unquoted,
    labelsReplaced: attempt.labelsReplaced,
    spellingChanges: attempt.spellingChanges,
    personalDetail: { found, retried, removed },
  };
}
