import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { usageLogger } from "@/lib/coach/usage";
import { callSettings } from "@/lib/transcripts/model";
import { VOICE_CORE } from "@/lib/voice/core";
import { findBannedPhrases } from "@/lib/voice/banned";
import { PERSONAL_DETAIL_RULE } from "@/lib/voice/personal-detail";
import { findDenials } from "./narrative";
import { checkPledgeDraft, PLEDGE_MAX_WORDS, type PledgeFacts } from "./pledge";

// THE PLEDGE CALL (diagnostic_pledge). Drafts the owner's capacity
// pledge in their own voice from the kickoff answers. Haiku 5.5,
// thinking off, plain text under 120 words. The draft goes into the
// box for the lead to edit; nothing sends it. A draft that drops one of
// the promises, runs long, invents a number or breaks the voice rules
// is asked for again once, then refused, and the box keeps what it had.

const DEFAULT_MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 800;

const SYSTEM = `You write a short message a small business owner sends their team on the first day of a three-week Capacity Diagnostic. The diagnostic looks at the work that gets in the way of people's best work, so they can get time back for the work that matters.

Write it as the owner, in the first person, to their own team: warm, direct and plain, the way an owner talks to people they know. Write it fresh for this business: use what the kickoff tells you about the company, its work, the people in scope and where the time will go, so it reads as theirs and could not be sent by any other owner.

It must say, in the owner's own words:
- nobody loses their job because of this, and that promise holds for 12 months;
- it asks about 45 minutes of each person: a 15-minute survey and a 30-minute conversation with the person running it, named;
- what each person tells the person running it stays with the person running it (say "stays with" and their first name), and the owner sees combined results, never individual answers;
- where the time goes first, when the kickoff names a Capacity Destination.

Rules:
- Under ${PLEDGE_MAX_WORDS} words. Start with a greeting and end with the owner's first name on its own line.
- Use no number except 12, 45, 15 and 30 as above, and any number in the kickoff answers.
- Say nothing about scheduling, dates, booking or next steps; the kickoff has not given them.
- No headings, no bullet points, no subject line, no exclamation marks, no sales language.
- Name the person running it, and after that say "they" or use their name; never "he" or "she".
- Say what is true. Never set a thing against what it is not ("this isn't about X, it's about Y").
- ${PERSONAL_DETAIL_RULE}

Return only the message.

${VOICE_CORE}`;

export type PledgeDraft = { ok: true; text: string } | { ok: false; message: string };

export async function writePledge(facts: PledgeFacts): Promise<PledgeDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, message: "Pledge drafting isn't set up on this server." };
  const model = process.env.ANTHROPIC_DIAGNOSTIC_PLEDGE_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });
  const log = usageLogger({ companyId: null, purpose: "diagnostic_pledge", model });
  const input = JSON.stringify({
    owner_first_name: facts.ownerName?.trim().split(/\s+/)[0] ?? null,
    company: facts.company,
    industry: facts.industry,
    people_in_scope: facts.scope,
    capacity_destination: facts.destination,
    person_running_the_diagnostic: facts.leadName,
  });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: input }];

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const message = await client.messages.create({ model, max_tokens: MAX_TOKENS, system: SYSTEM, messages, ...callSettings(model, "off") });
      log(message);
      const raw = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const { text, problems } = checkPledgeDraft(raw, facts);
      const voice = [...findBannedPhrases(text), ...findDenials(text)].map((h) => `it uses "${h.phrase}"`);
      const all = [...problems, ...voice];
      if (text && all.length === 0) return { ok: true, text };
      messages.push({ role: "assistant", content: raw || "(empty)" }, { role: "user", content: `Write it again: ${all.join("; ") || "it came back empty"}. Keep everything else.` });
      if (attempt === 1) console.warn("[diagnostics] pledge draft refused:", all);
    }
    return { ok: false, message: "The draft missed one of the promises. Try again, or edit the plain version." };
  } catch (err) {
    console.warn("[diagnostics] pledge draft failed:", err);
    return { ok: false, message: "The draft didn't come back. Try again." };
  }
}
