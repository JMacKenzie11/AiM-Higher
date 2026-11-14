// AIMEE'S FIRST-REPLY EVAL (docs/aimee-rules.md). Sends a fixed set of
// first messages to plain Aimee's real system prompt, several times
// each, and scores every reply with the same checks the route uses:
// how many would be sent back for a rewrite (SENT_BACK first reply),
// and every counted rule break. Synthetic messages only; no database.
//
//   npm run eval:aimee -- <label> [outDir] [repeats]
//
// Run it before and after any change to Aimee's instructions and put
// both summaries in the PR. One run varies a lot (10 vs 15 sent back
// on the same prompt, 2026-11-14), so compare three runs a side.
import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const label = process.argv[2] ?? "run";
const { loadSystemPrompt } = await import("@/lib/coach/turn/prompt");
const { checkVoice, SENT_BACK, COUNTED } = await import("@/lib/aimee/voice-check");
const { default: Anthropic } = await import("@anthropic-ai/sdk");
const client = new Anthropic();
const system = await loadSystemPrompt("general", null);
const MESSAGES = [
  "One of my project managers keeps saying he's too busy whenever I ask for updates. How do I handle that?",
  "I need help with two comments I always hear from the team: \"I'm too busy\" and \"I'm stressed\". I think procrastination is part of it.",
  "Sarah is brilliant with clients but terrible at following up internally. It's driving the office crazy.",
  "How do I run a better weekly meeting? Ours drag on and nothing gets decided.",
  "I have to tell my operations lead she isn't getting the promotion. How should I start?",
  "My business partner and I disagree about hiring another estimator. How do I talk to him about it?",
  "What's a good way to set priorities for next quarter with my leadership team?",
  "I keep taking work back from people when they're slow. I know I shouldn't.",
  "Our new hire seems disengaged after three weeks. What should I do?",
  "How do I give feedback to someone who gets defensive every time?",
  "I'm worried we're overcommitting every quarter. Everyone takes on too much.",
  "Can you help me think through whether to let a long-time employee go?",
];
const REPEATS = Number(process.argv[4] ?? 2);
type Row = { msg: number; text: string; sentBack: string[]; counted: string[]; words: number; out: number };
const rows: Row[] = [];
const jobs = MESSAGES.flatMap((m, i) => Array.from({ length: REPEATS }, () => [m, i] as const));
for (let k = 0; k < jobs.length; k += 6) {
  const batch = await Promise.all(jobs.slice(k, k + 6).map(async ([m, i]) => {
    const r = await client.messages.create({ model: "claude-sonnet-5", max_tokens: 8000, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: m }] });
    const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    const ctx = { userText: m, skippedStrength: false };
    return { msg: i, text, sentBack: checkVoice(text, SENT_BACK["first reply"], ctx).rules, counted: checkVoice(text, COUNTED, ctx).rules, words: text.split(/\s+/).filter(Boolean).length, out: r.usage.output_tokens } as Row;
  }));
  rows.push(...batch);
}
const tally = (k: "sentBack" | "counted") => { const t: Record<string, number> = {}; for (const r of rows) for (const x of r[k]) t[x] = (t[x] ?? 0) + 1; return t; };
const summary = {
  label, systemChars: system.length, replies: rows.length,
  repliesSentBack: rows.filter((r) => r.sentBack.length > 0).length,
  repliesWithAnyCountedBreak: rows.filter((r) => r.counted.length > 0).length,
  countedBreaks: rows.reduce((n, r) => n + r.counted.length, 0),
  medianWords: rows.map((r) => r.words).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  sentBackRules: tally("sentBack"), countedRules: tally("counted"),
};
console.log(JSON.stringify(summary, null, 1));
writeFileSync(`${process.argv[3] ?? "/tmp"}/aimee-eval-${label}.json`, JSON.stringify({ summary, rows }, null, 1));
