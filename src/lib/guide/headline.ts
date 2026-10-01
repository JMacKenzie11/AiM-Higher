import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { VOICE_CORE } from "@/lib/voice/core";
import { stripEmDashes } from "@/lib/voice/strip-dashes";
import { findBannedPhrases, describeHits } from "@/lib/voice/banned";
import { findUnsupportedQuotes } from "@/lib/voice/quotes";
import { personalDetailMatcher, PERSONAL_DETAIL_RULE, type PersonalDetailMatcher } from "@/lib/voice/personal-detail";
import { attendeesFromSummary } from "@/lib/transcripts/attendees";
import { callSettings } from "@/lib/transcripts/model";
import { checkDebriefReply, describeReplyFaults } from "./reply-checks";
import { meetingDayLabel } from "./meeting-label";

// THE CARD IS THE PRODUCT.
//
// It is the only thing the Guide says before a person chooses to
// engage, and it is the whole of the first impression. "Your meeting
// was analyzed" is a system message: it tells the champion something
// they could have guessed, and teaches them the card is machinery
// rather than a person worth answering.
//
// ---- THREE PIECES, WRITTEN TOGETHER (Jason, 2026-09-29) --------
//
// The card in Aimee's panel: the meeting's name and date (not written
// here, see meeting-label.ts), a HEADLINE stating one strength, and a
// short INVITATION line. When they click "Talk it through", Aimee's
// first message, the OPENER, adds what the card could not: the moment,
// one short quote checked against the transcript, why it matters, and
// one question. It never repeats the headline.
//
// One call writes all three, so they are about the same moment. Asked
// separately, the opener wandered to a different moment than the
// headline (dev drafts, 2026-09-29).
//
// ---- WHY THIS IS SAFE TO GENERATE IN A JOB ---------------------
//
// It reads the meeting's analysis and transcript, company data
// written by the same pipeline under the same admin client. It never
// touches coach memory, which is person-scoped and unreachable without
// a session (0194). The conversation that follows does use memory,
// and that happens under the champion's own login.
//
// ---- CHECKED, SENT BACK ONCE, AND NEVER SENT WRONG --------------
//
// The rules that can be counted are counted (checkCard). Up to three
// tries, each told what was wrong. A piece still wrong after that is replaced,
// not sent: the headline by the plain line (and the others with it,
// since they are about its moment), the invitation by a plain one, the
// opener by nothing, in which case the debrief opens on the card's own
// words. Each is said in the log (failure mode E13).
//
// ---- IF IT FAILS -----------------------------------------------
//
// The plain card, and the nudge is still raised. A failed call must
// never cost somebody the invitation.

// The plain card, used when the written one could not be made clean.
// The day in words: the ISO date it used to carry read as a system
// message, the thing the card exists not to be.
export const HEADLINE_FALLBACK = (meetingDate: string) =>
  `The summary of your meeting on ${meetingDayLabel(meetingDate)} is ready.`;
export const INVITATION_FALLBACK = "Want to talk it through?";

// Two lines of the card at the panel's width, and one.
export const HEADLINE_MAX_CHARS = 100;
export const INVITATION_MAX_CHARS = 45;
const OPENER_MAX_WORDS = 85;
const MAX_TRIES = 3;

export type InvitationCard = {
  headline: string;
  invitation: string;
  // Null when it could not be written clean; the debrief then opens on
  // the headline and invitation.
  opener: string | null;
};

const SYSTEM = `You are Aimee, the AiMS leadership coach. A leadership team's weekly meeting has just been summarised. You write three things for the company's AiMS champion, who was in the meeting.

First choose ONE moment that shows something the team did well, and that has a clear line somebody said in the transcript. All three pieces are about that moment.

1. HEADLINE, on a small card. One sentence stating the strength, as a pure strength.
   - State the strength itself. Never phrase it so it implies the opposite was expected. "Nobody took it personally" implies somebody might have; "The team debated pricing openly and kept it constructive" says it as a strength. None of "without", "nobody", "didn't", "instead of", "rather than".
   - Specific: the topic and what the team did. At most ${HEADLINE_MAX_CHARS} characters. Sentence case. Plain words. No quotation marks.
   - Never a recap, a count, a score or a grade.

2. INVITATION, under piece 1. One light, complete question, at most ${INVITATION_MAX_CHARS} characters, such as "Want to look at what made that work?". Worded differently from every recent invitation you are given. No exclamation marks.

3. OPENER, Aimee's first message when they click "Talk it through". They have just read piece 1: do not repeat or restate it. Add what the card could not, in this order:
   a. The moment, starting straight in: what was being discussed, and what somebody did. No sentence about the moment itself ("What stood out").
   b. One short quote on its own line: under 15 words, copied EXACTLY from the transcript, one continuous span (never joined with "..."), in quotation marks. Words that read clearly on their own and carry the strength.
   c. Why it matters, in one sentence: what it gives the team. Never what it avoids, saves or prevents, and never what something else would miss.
   d. One generative question on its own line: what made it possible, or how to carry it forward. Never a status check.
   Under 75 words. Short sentences, contractions. No lists, headings or bold. Never use the same phrase in two sentences in a row: say it once, then move on.

For all three:
- Who is reading: the champion. Say "you" only for what they did themselves, when you are told who they are. Otherwise "your team", or the person's name for what somebody did.
- Name only people on the leadership team. Never "Speaker 1" or any other speaker label.
- ${PERSONAL_DETAIL_RULE}
- Never contrast what happened with what did not ("X instead of Y", "not just"). Never reassure by denying the opposite. No metaphors like "landed". No promises: you cannot remind, schedule or follow up.

${VOICE_CORE}

Reply with JSON only: {"moment": "...", "headline": "...", "invitation": "...", "opener": "..."}`;

// Exported for the shared voice test, which holds every generated
// surface against the same handful of rules. Not for runtime use.
export const HEADLINE_RULES_FOR_TEST = SYSTEM;

// ---- THE CHECKS -------------------------------------------------

// Words that make a strength sound like relief that the opposite
// did not happen (Jason, 2026-09-29: "Nobody took it personally").
const IMPLIES_OPPOSITE =
  /\b(without|nobody|no one|no-one|didn['’]t|did not|never|instead of|rather than|wasn['’]t|weren['’]t|not just)\b/i;

const SPEAKER_LABEL = /\bspeaker\s*\d+\b/i;
const YOU_FOR_OTHERS = /\byou (?:two|both)\b/i;
const WAS_ANALYZED = /\b(your|the)\s+meeting\s+(was|has been)\s+analy[sz]ed/i;

const STOPWORDS = new Set(
  "a an and are as at be but by for from has have in is it its of on or so that the their them they this to was were what when which who will with your you our we".split(" ")
);

function sentencesOf(text: string): string[] {
  return (text.match(/[^.?!\n]+[.?!]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

function withoutQuotes(text: string): string {
  return text.replace(/["“][^"”]*["”]/g, " ");
}

// The same three words in two sentences in a row (Jason, 2026-09-29:
// "the full picture of what customers experience", then "a truer
// picture of what customers actually experience"). Three words, one of
// them more than filler, so "of the team" twice is not a repeat.
export function repeatedPhrases(text: string): string[] {
  const grams = (s: string) => {
    const w = s.toLowerCase().match(/[a-z']+/g) ?? [];
    const out = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) {
      const g = w.slice(i, i + 3);
      if (g.some((x) => !STOPWORDS.has(x) && x.length >= 4)) out.add(g.join(" "));
    }
    return out;
  };
  const s = sentencesOf(withoutQuotes(text));
  const hits: string[] = [];
  for (let i = 0; i + 1 < s.length; i++) {
    const next = grams(s[i + 1]);
    for (const g of grams(s[i])) if (next.has(g)) hits.push(g);
  }
  return hits;
}

function sameLine(a: string, b: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

export type CardFaults = { headline: string[]; invitation: string[]; opener: string[] };

// Somebody's private life (Jason, 2026-09-29: the Centre North draft
// gave Jeff's doctor's appointment as why he was away). The card is a
// record of the meeting's work, so a physiotherapy clinic's own
// appointments pass. The words live in voice/personal-detail.ts.
export function checkCard(
  card: { headline: string; invitation: string; opener: string },
  transcript: string,
  recentInvitations: readonly string[],
  personalDetail: PersonalDetailMatcher = personalDetailMatcher({ mode: "record" })
): CardFaults {
  const headline: string[] = [];
  const h = card.headline;
  if (h.length < 15) headline.push("headline is missing");
  if (h.length > HEADLINE_MAX_CHARS) headline.push(`headline is ${h.length} characters, over ${HEADLINE_MAX_CHARS}`);
  const hBanned = findBannedPhrases(h);
  if (hBanned.length) headline.push(`headline uses ${describeHits(hBanned)}`);
  const hOpp = h.match(IMPLIES_OPPOSITE);
  if (hOpp) headline.push(`headline says "${hOpp[0]}", which implies the opposite was expected`);
  if (/["“”]/.test(h)) headline.push("headline quotes somebody");
  if (WAS_ANALYZED.test(h)) headline.push("headline says the meeting was analyzed");

  const invitation: string[] = [];
  const inv = card.invitation;
  if (inv.length < 5) invitation.push("the invitation is missing");
  if (inv.length > INVITATION_MAX_CHARS) invitation.push(`the invitation is ${inv.length} characters, over ${INVITATION_MAX_CHARS}`);
  if (!inv.trim().endsWith("?")) invitation.push("the invitation is not a question");
  const iBanned = findBannedPhrases(inv);
  if (iBanned.length) invitation.push(`the invitation uses ${describeHits(iBanned)}`);
  if (recentInvitations.some((r) => sameLine(r, inv))) invitation.push("the invitation repeats a recent one");

  const opener: string[] = [];
  const o = card.opener;
  if (o.length < 20) opener.push("the opener is missing");
  const quotes = o.match(/["“][^"”]+["”]/g) ?? [];
  if (quotes.length !== 1) opener.push(`the opener has ${quotes.length} quotes, not one`);
  // Aimee's own words against the reply rules; a quote is somebody
  // else's, and is checked against the transcript instead.
  const ownWords = checkDebriefReply(withoutQuotes(o), "");
  const invented = transcript ? findUnsupportedQuotes(o, transcript) : [];
  const described = describeReplyFaults({ ...ownWords, invented });
  if (described) opener.push(`the opener: ${described}`);
  if (SPEAKER_LABEL.test(o)) opener.push("the opener uses a speaker label");
  if (YOU_FOR_OTHERS.test(o)) opener.push(`the opener says "${o.match(YOU_FOR_OTHERS)![0]}" about people who may not be the reader`);
  const words = o.split(/\s+/).filter(Boolean).length;
  if (words > OPENER_MAX_WORDS) opener.push(`the opener is ${words} words, over 75`);
  const repeats = repeatedPhrases(o);
  if (repeats.length) opener.push(`the opener repeats "${repeats[0]}" in two sentences in a row`);
  if (sameLine(o.slice(0, h.length), h)) opener.push("opener repeats piece 1");

  for (const [name, text, list] of [
    ["headline", h, headline],
    ["invitation", inv, invitation],
    ["opener", o, opener],
  ] as const) {
    const m = personalDetail(text);
    if (m) list.push(`the ${name} mentions "${m}", a personal reason for somebody's absence`);
  }
  return { headline, invitation, opener };
}

function count(f: CardFaults): number {
  return f.headline.length + f.invitation.length + f.opener.length;
}

function all(f: CardFaults): string[] {
  return [...f.headline, ...f.invitation, ...f.opener];
}

// ---- WRITING IT ------------------------------------------------

type Raw = { headline: string; invitation: string; opener: string };

function parse(text: string): Raw | null {
  try {
    const j = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()) as Record<string, unknown>;
    const clean = (v: unknown) => stripEmDashes(String(v ?? "").replace(/\s+\n/g, "\n").trim());
    return {
      headline: clean(j.headline).replace(/^["'“”]+|["'“”]+$/g, "").replace(/\s+/g, " "),
      invitation: clean(j.invitation).replace(/\s+/g, " "),
      // Its parts on their own lines: the moment, the quote, why, the
      // question. A single line break is a space in the chat, so the
      // parts ran together as one paragraph on dev (2026-09-29).
      opener: clean(j.opener)
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n\n"),
    };
  } catch {
    return null;
  }
}

export async function generateInvitationCard(
  client: Anthropic,
  input: {
    model: string;
    meetingDate: string;
    companyName: string;
    analysisMarkdown: string;
    transcript: string;
    championName: string | null;
    strengths: string[];
    recentInvitations: string[];
  }
): Promise<InvitationCard> {
  // The names the card can mention, so "Jeff was out with the flu" is
  // caught as well as the words that are private anywhere.
  const personalDetail = personalDetailMatcher({
    mode: "record",
    people: [...attendeesFromSummary(input.analysisMarkdown), ...(input.championName ? [input.championName] : [])],
  });
  const plain: InvitationCard = {
    headline: HEADLINE_FALLBACK(input.meetingDate),
    invitation: INVITATION_FALLBACK,
    opener: null,
  };
  try {
    const strengths =
      input.strengths.length > 0
        ? `\n\nWhat the facilitation review noticed went well:\n${input.strengths.map((s) => `- ${s}`).join("\n")}`
        : "";
    const recent =
      input.recentInvitations.length > 0
        ? input.recentInvitations.map((r) => `- ${r}`).join("\n")
        : "(none yet)";
    const userTurn =
      `Company: ${input.companyName}\nMeeting date: ${input.meetingDate}` +
      `\nWritten to: ${input.championName ?? "the company's AiMS champion (name unknown)"}` +
      `\nRecent invitations for this company:\n${recent}` +
      `${strengths}\n\n<summary>\n${input.analysisMarkdown.slice(0, 12000)}\n</summary>` +
      `\n\n<transcript>\n${input.transcript.slice(0, 70000)}\n</transcript>`;

    const ask = async (messages: Anthropic.MessageParam[]): Promise<{ raw: string; card: Raw | null }> => {
      const response = await client.messages.create({
        model: input.model,
        // Choosing the moment and finding a quotable line in a long
        // transcript is the hard part, so it thinks, with room to
        // answer after. A short budget with thinking on came back with
        // no text at all (2026-09-29). On Opus 5.5 at the lowest effort
        // (transcripts/model.ts).
        ...callSettings(input.model, "adaptive"),
        max_tokens: 8000,
        system: [{ type: "text", text: SYSTEM }],
        messages,
      });
      const raw = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return { raw, card: parse(raw) };
    };

    // Up to three tries (Jason, 2026-09-29): this is written in the
    // background, so a retry costs nobody a wait. Each retry is sent
    // what was wrong with the one before it. The best attempt wins:
    // the first clean one, or the one with fewest faults.
    let card: Raw | null = null;
    let faults: CardFaults | null = null;
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: userTurn }];
    for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
      const got = await ask(messages);
      const gotFaults = got.card ? checkCard(got.card, input.transcript, input.recentInvitations, personalDetail) : null;
      if (got.card && gotFaults && (!faults || count(gotFaults) < count(faults))) {
        card = got.card;
        faults = gotFaults;
      }
      if (faults && count(faults) === 0) break;
      if (attempt === MAX_TRIES) break;
      const what = gotFaults ? all(gotFaults).join("; ") : "the reply was not the JSON asked for";
      console.log(`[guide] card try ${attempt} sent back: ${what}`);
      messages = [
        { role: "user", content: userTurn },
        { role: "assistant", content: got.raw || "{}" },
        {
          role: "user",
          content:
            `Problems: ${what}. Write all three again as if for the first time, ` +
            `as the same JSON, fixing those. No preamble.`,
        },
      ];
    }

    if (!card || !faults) {
      console.error("[guide] card could not be written, sending the plain card");
      return plain;
    }
    // Still wrong after three tries: the piece is replaced, never
    // stored or sent.
    if (faults.headline.length > 0) {
      console.error(`[guide] headline still breaking the rules after three tries, sending the plain card: ${faults.headline.join("; ")}`);
      return plain;
    }
    const invitation = faults.invitation.length > 0 ? INVITATION_FALLBACK : card.invitation;
    if (faults.invitation.length > 0) {
      console.error(`[guide] invitation still breaking the rules after three tries, sending the plain one: ${faults.invitation.join("; ")}`);
    }
    const opener = faults.opener.length > 0 ? null : card.opener;
    if (faults.opener.length > 0) {
      console.error(`[guide] opener still breaking the rules after three tries, the debrief opens on the card: ${faults.opener.join("; ")}`);
    }
    return { headline: card.headline, invitation, opener };
  } catch (err) {
    console.error("[guide] card generation failed:", err instanceof Error ? err.message : err);
    return plain;
  }
}
