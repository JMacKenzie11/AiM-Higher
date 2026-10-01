// Did the first reply acknowledge a strength the person named? (Jason,
// 2026-09-30.) "Great with the crew but terrible at paperwork" should get
// the crew first. Wording varies too much for a pattern, so a small, fast
// model reads the two texts and answers in one line.
//
// It runs only when the person's message has a turn in it ("but",
// "though", "yet", "except"), and it fails open: no answer within the
// time limit, or an answer it cannot read, counts as acknowledged. A
// slow check must never hold a reply back, and a missed one is counted
// in the weekly figures like any other.
import type Anthropic from "@anthropic-ai/sdk";

export const STRENGTH_CHECK_MODEL = "claude-haiku-4-5";
const TIME_LIMIT_MS = 2500;
const HAS_A_TURN = /\b(?:but|though|although|yet|except)\b/i;

export function mightNameAStrength(userText: string): boolean {
  return HAS_A_TURN.test(userText);
}

const SYSTEM = `You check one thing. A leader described someone on their team, and a coach replied. Decide whether the leader named something that person does well, and if so, whether the coach's reply acknowledges that strength before it asks about the difficulty.

Answer with one line of JSON and nothing else:
{"strength": "<the strength in the leader's words, or null if they named none>", "acknowledged": true|false}

"acknowledged" is true when there is no strength, or when the reply's opening sentence refers to it. Rewording counts ("great with the crew" / "good with the crew").`;

export type StrengthVerdict = { strength: string | null; acknowledged: boolean };

export function readVerdict(raw: string): StrengthVerdict {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { strength: null, acknowledged: true };
  try {
    const v = JSON.parse(m[0]) as { strength?: unknown; acknowledged?: unknown };
    const strength = typeof v.strength === "string" && v.strength.trim() ? v.strength.trim() : null;
    return { strength, acknowledged: strength === null || v.acknowledged !== false };
  } catch {
    return { strength: null, acknowledged: true };
  }
}

// Returns the named strength when the reply skipped it, otherwise null.
// onUsage receives each call's billed tokens, so the check's cost
// reaches the usage log with the turn it belongs to.
export async function skippedStrength(
  client: Pick<Anthropic, "messages">,
  userText: string,
  reply: string,
  onUsage?: (usage: Anthropic.Usage) => void
): Promise<string | null> {
  if (!mightNameAStrength(userText)) return null;
  try {
    const res = await client.messages.create(
      {
        model: STRENGTH_CHECK_MODEL,
        max_tokens: 80,
        system: SYSTEM,
        messages: [{ role: "user", content: `<leader>${userText}</leader>\n<reply>${reply}</reply>` }],
      },
      { timeout: TIME_LIMIT_MS, maxRetries: 0 }
    );
    if (res.usage) onUsage?.(res.usage);
    const raw = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const v = readVerdict(raw);
    return v.acknowledged ? null : v.strength;
  } catch (err) {
    console.error("[coach] strength check skipped:", err instanceof Error ? err.message : err);
    return null;
  }
}
