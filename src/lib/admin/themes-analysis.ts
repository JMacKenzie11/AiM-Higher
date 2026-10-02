import type Anthropic from "@anthropic-ai/sdk";
import { ANONYMITY_RULE, type AnonymityFault, type Anonymiser } from "@/lib/aimee/anonymise";

// FIVE THEMES ACROSS RECENT CONVERSATIONS, ANONYMOUSLY, for the themes
// card (/api/cron/themes). The titles and first messages arrive
// already scrubbed (aimee/anonymise.ts). Each theme's label and
// description is checked before it is stored: a theme that names
// somebody, a role one person holds or a personal detail is sent back
// once, naming the fault, and a theme still breaking the rule is
// dropped. Themes are counts across many conversations, so losing one
// is a small cost.

export type ThemeItem = { label: string; count: number; description: string };

export type AnonymousThemes = {
  themes: ThemeItem[];
  retried: boolean;
  dropped: number;
};

function prompt(lines: readonly string[]): string {
  return `You will cluster a list of workplace coaching conversations into the top 5 themes.

Rules:
- Return EXACTLY 5 themes covering the largest share of the input.
- Each theme label is 2-4 plain words a business owner would use out loud.
- Each description is one sentence: what leaders are working on when they open this kind of conversation.
- No therapy-speak, no consultant jargon, no metaphors. Say the literal thing.
- Do not include a "miscellaneous" or "other" theme; force the fifth-most-common theme even if it is small.
- ANONYMITY (non-negotiable): ${ANONYMITY_RULE} Names in the input have already been replaced with "a colleague" and "the company".

Return ONLY a JSON object with this exact shape (no code fences, no prose):
{
  "themes": [
    { "label": "string", "count": integer, "description": "string" }
  ]
}

Where "count" is your best estimate of how many of the input conversations fit each theme.

Input (${lines.length} conversations):
${lines.join("\n")}`;
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export function parseThemes(text: string): ThemeItem[] {
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim()) as { themes?: unknown };
  if (!Array.isArray(parsed.themes)) return [];
  return parsed.themes
    .filter(
      (t: unknown): t is ThemeItem =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as { label?: unknown }).label === "string" &&
        typeof (t as { count?: unknown }).count === "number" &&
        typeof (t as { description?: unknown }).description === "string"
    )
    .slice(0, 5);
}

const faultsOf = (t: ThemeItem, anon: Anonymiser): AnonymityFault[] => [
  ...new Set([...anon.faults(t.label), ...anon.faults(t.description)]),
];

// Throws when the first answer is not JSON, as the job always has: a
// themes run with nothing to store is reported as an error.
export async function clusterThemes(
  client: Anthropic,
  model: string,
  scrubbedLines: readonly string[],
  anon: Anonymiser,
  onMessage?: (m: Anthropic.Message) => void
): Promise<AnonymousThemes> {
  const ask: Anthropic.MessageParam[] = [{ role: "user", content: prompt(scrubbedLines) }];
  const first = await client.messages.create({ model, max_tokens: 900, messages: ask });
  onMessage?.(first);
  let themes = parseThemes(textOf(first));
  const faults = [...new Set(themes.flatMap((t) => faultsOf(t, anon)))];
  if (faults.length === 0) return { themes, retried: false, dropped: 0 };

  const second = await client.messages.create({
    model,
    max_tokens: 900,
    messages: [
      ...ask,
      { role: "assistant", content: textOf(first) },
      { role: "user", content: `Your themes contain ${faults.join(" and ")}. Return the same JSON with it left out, following the anonymity rule.` },
    ],
  });
  onMessage?.(second);
  try {
    const retried = parseThemes(textOf(second));
    if (retried.length > 0) themes = retried;
  } catch {
    // A retry that does not parse leaves the first answer, cleaned.
  }
  const kept = themes.filter((t) => faultsOf(t, anon).length === 0);
  return { themes: kept, retried: true, dropped: themes.length - kept.length };
}
