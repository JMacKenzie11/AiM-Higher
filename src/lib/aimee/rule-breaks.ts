import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/types";
import { findBannedPhrases } from "@/lib/voice/banned";

// COUNTING REPLIES SHOWN WITH A VOICE RULE BROKEN (0244).
//
// Jason, 2026-09-29, wants to see how often it happens before deciding
// anything more:
//
//   debrief_reply / opener   a checked turn. It is sent back once, and
//                            the better attempt is shown even when it
//                            still breaks a rule, so a reply never
//                            goes blank. Every one shown that way is
//                            counted, with the rules.
//   conversation             an ordinary Aimee reply, on the page or
//                            in the panel. It streams, so it is not
//                            checked before it is read and never
//                            retried. Dashes are taken out of every
//                            one (the saved text here, the shown text
//                            in ChatView); anything else on the banned
//                            list is counted.
//
// Counted in voice_rule_breaks and read by `npm run aimee:uptake`, and
// said in the log. Rule names only, never the reply: coaching is
// private.

export type RuleBreakSurface = "debrief_reply" | "opener" | "conversation";

function outsideQuotes(text: string): string {
  return text.replace(/["“][^"”]*["”]/g, '""');
}

// The banned list's labels for what is in Aimee's own words, once
// each. A quote is what somebody said and is theirs.
// A reply opening with her name (Jason, 2026-09-29). The panel's header
// and greeting, and the Aimee page, already say who she is.
const INTRODUCES_HERSELF = /^\s*(?:(?:hi|hello|hey)[,!.]?\s+)?(?:i(?:'|’)m|i am)\s+aimee\b/i;

export function introducesHerself(text: string): boolean {
  return INTRODUCES_HERSELF.test(text);
}

// The debrief's contrast phrases (lib/guide/reply-checks.ts), counted
// here in every reply (Jason, 2026-09-29). "X instead of Y" is already
// on the banned list; these two are not, because the prompts use them.
const CONTRASTS: ReadonlyArray<[string, RegExp]> = [
  ["rather than", /\brather than\b/i],
  ["not just", /\bnot just\b/i],
];

// Two slips from the 2026-09-30 test replies, counted where a pattern
// can say so without guessing (Jason). Two more from the same replies
// are not counted, because they would need guesswork: an assumed
// gender (whether "she" means the person they described), and a
// question that offers a list.
//
// A stock opening: a phrase that turns up in the first sentence of
// reply after reply. Counting a repeat across replies would mean
// keeping the replies' words, which this table never does, so it
// counts the phrases already seen repeating, by name. Add to the list
// when the weekly figures or a transcript show a new one.
const STOCK_OPENINGS: ReadonlyArray<[string, RegExp]> = [
  ["is real", /\bis real\b/i],
  ["worth paying attention to", /\bworth paying attention to\b/i],
  ["a lot to carry", /\ba lot to carry\b/i],
];

// Their harsh word said back to them ("What does 'awful to the ops
// team' look like?"). Quoted or not: quoting it is the slip.
const HARSH_WORDS =
  /\b(?:terrible|useless|hopeless|awful|horrible|lazy|incompetent|pathetic|worthless|clueless|stupid|idiot(?:ic)?|a disaster|a nightmare)\b/gi;

function firstSentence(text: string): string {
  return text.trim().split(/(?<=[.?!])\s|\n/)[0] ?? "";
}

export function harshWordsRepeated(userText: string, reply: string): string[] {
  const theirs = new Set((userText.match(HARSH_WORDS) ?? []).map((w) => w.toLowerCase()));
  return [...new Set((reply.match(HARSH_WORDS) ?? []).map((w) => w.toLowerCase()))].filter((w) => theirs.has(w));
}

// userText: the person's message this reply answers, for the harsh-word
// count. Without it, that count is skipped.
export function bannedRulesIn(text: string, userText = ""): string[] {
  const own = outsideQuotes(text);
  const rules = findBannedPhrases(own).map((h) => h.phrase);
  for (const [name, re] of CONTRASTS) if (re.test(own)) rules.push(name);
  const opening = outsideQuotes(firstSentence(text));
  for (const [name, re] of STOCK_OPENINGS) if (re.test(opening)) rules.push(`stock opening: ${name}`);
  if (harshWordsRepeated(userText, text).length > 0) rules.push("repeated their harsh word");
  if (INTRODUCES_HERSELF.test(text)) rules.unshift("introduced herself");
  return [...new Set(rules)];
}

export async function recordRuleBreak(
  supabase: SupabaseClient,
  args: {
    companyId: string | null;
    profileId: string;
    role: Role;
    conversationId: string;
    surface: RuleBreakSurface;
    origin?: "page" | "panel" | null;
    rules: string[];
  }
): Promise<void> {
  const rules = [...new Set(args.rules)].filter(Boolean);
  if (rules.length === 0) return;
  console.warn(
    `[aimee] ${args.surface} shown with a voice rule still broken (${args.conversationId}): ${rules.join(", ")}`
  );
  // portfolio_admin has no company of its own and writes only its four
  // tables (CLAUDE.md, Permissions); the log line above is its record.
  if (!args.companyId || args.role === "portfolio_admin") return;
  const { error } = await supabase.from("voice_rule_breaks").insert({
    company_id: args.companyId,
    profile_id: args.profileId,
    surface: args.surface,
    origin: args.surface === "conversation" ? (args.origin ?? "page") : null,
    rules,
  });
  if (error) {
    console.error("[aimee] rule break not recorded", { surface: args.surface, code: error.code, message: error.message });
  }
}
