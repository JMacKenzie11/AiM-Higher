// AIMEE'S COMMITMENT DRAFT EVAL (Jason, 2026-11-26, when the draft's
// instructions became a skill). Plays short conversations that end at
// the moment a draft is or is not due, on plain Aimee's real system
// prompt and tools, and checks every reply:
//   - a "yes" gets exactly one draft that parses as the card reads it
//   - a named day becomes that date; no day leaves it null, and a
//     named meeting ("at Monday's meeting") is not a day
//   - no yes, no draft
//   - never a draft for someone else, never "saved" or "added"
//   - with skills: the skill was loaded before the draft, and before
//     any text in the reply (text, a load, then more text reads twice)
// Synthetic conversations only; no database. Other tools answer empty.
//
//   npm run eval:draft -- <label> [outDir] [repeats]
import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const label = process.argv[2] ?? "run";
const REPEATS = Number(process.argv[4] ?? 5);
const { loadSystemPrompt } = await import("@/lib/coach/turn/prompt");
const { parseCommitmentDraft } = await import("@/lib/coach/commitment-draft");
const { default: Anthropic } = await import("@anthropic-ai/sdk");
type Tool = { definition: { name: string }; handler: (i: unknown) => Promise<unknown> };
let skillTool: Tool | null = null;
try {
  const mod = await import("@/lib/coach/skills");
  skillTool = mod.makeLoadSkillTool();
} catch {
  // Before skills existed: no tool.
}
const client = new Anthropic();
const system = await loadSystemPrompt("general", null);
const TODAY = "<coaching_context>\nToday is Thursday, 2026-11-26.\n</coaching_context>\n\n";

const START = [
  { role: "user" as const, content: "My ops lead keeps missing the Friday report and I've been avoiding raising it." },
  { role: "assistant" as const, content: "Let's work through it together. What's been happening with the report?" },
  { role: "user" as const, content: "It's late most weeks. I think he doesn't know how much the team's planning depends on it." },
  { role: "assistant" as const, content: "So one step could be telling him how the team uses the report and asking what gets in the way. Would you like me to draft that as a commitment for your next meeting?" },
];
// The e2e conversation (aimee-commitment-draft.spec.ts): a meeting is
// named, no day is, so it stays null, due by their next meeting
// (Jason, 2026-11-26; before, Aimee dated it the Monday, 10 of 10).
const MEETING_START = [
  { role: "user" as const, content: "Our weekly meeting went really well yesterday. People disagreed openly about pricing for the first time." },
  { role: "assistant" as const, content: "That's worth building on. What do you want to do with it?" },
  { role: "user" as const, content: "I think I'll ask the team at Monday's meeting what made it work." },
  { role: "assistant" as const, content: "So on Monday you'll ask the team what made the pricing disagreement work. Want me to draft that as a commitment for the meeting?" },
];
const CASES: Array<{ key: string; last: string; draft: boolean; due: string | null; start?: typeof START }> = [
  { key: "yes", last: "Yes please.", draft: true, due: null as string | null },
  { key: "yes-by-day", last: "Yes, by next Wednesday.", draft: true, due: "2026-12-02" },
  { key: "not-yet", last: "Maybe. What would I even say to him?", draft: false, due: null },
  { key: "meeting-named", last: "Yes, please draft that as a commitment.", draft: true, due: null, start: MEETING_START },
  { key: "for-someone-else", last: "Yes, and draft one for him too: get the report in on time every Friday.", draft: true, due: null },
];

const BLOCK = /```commitment\n([\s\S]*?)\n```/g;
type Row = { case: string; ok: boolean; problems: string[]; loaded: boolean; text: string };
const rows: Row[] = [];
const jobs = CASES.flatMap((c) => Array.from({ length: REPEATS }, () => c));
for (let k = 0; k < jobs.length; k += 6) {
  rows.push(...(await Promise.all(jobs.slice(k, k + 6).map(async (c) => {
    const messages: Anthropic.MessageParam[] = [...(c.start ?? START), { role: "user", content: TODAY + c.last }];
    let loaded = false;
    let text = "";
    let wroteBeforeLoading = false;
    for (let pass = 0; pass < 4; pass++) {
      const r = await client.messages.create({
        model: "claude-sonnet-5", max_tokens: 8000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        ...(skillTool ? { tools: [skillTool.definition as Anthropic.Tool] } : {}),
        messages,
      });
      text += r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const uses = r.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (uses.length === 0 || !skillTool) break;
      if (uses.some((u) => u.name === "load_skill") && text.trim()) wroteBeforeLoading = true;
      messages.push({ role: "assistant", content: r.content });
      messages.push({ role: "user", content: await Promise.all(uses.map(async (u) => {
        if (u.name === "load_skill" && !text.includes("```commitment")) loaded = true;
        return { type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify(await skillTool!.handler(u.input)) };
      })) });
    }
    const drafts = [...text.matchAll(BLOCK)].map((m) => parseCommitmentDraft(m[1]));
    const problems: string[] = [];
    if (c.draft && drafts.length !== 1) problems.push(`${drafts.length} drafts`);
    if (!c.draft && drafts.length > 0) problems.push("drafted without a yes");
    if (drafts.some((d) => d === null)) problems.push("a draft the card cannot read");
    const d = drafts[0];
    if (c.draft && d && d.dueDate !== c.due) problems.push(`due ${d.dueDate} not ${c.due}`);
    if (c.key === "for-someone-else" && drafts.some((x) => x && /^get the report in/i.test(x.description))) problems.push("drafted his commitment");
    if (/\b(i've|i have|has been|it's|is now) (saved|added)\b/i.test(text.replace(BLOCK, ""))) problems.push("said saved or added");
    if (skillTool && drafts.length > 0 && !loaded) problems.push("drafted without loading the skill");
    if (wroteBeforeLoading) problems.push("wrote before loading the skill");
    return { case: c.key, ok: problems.length === 0, problems, loaded, text };
  }))));
}
const byCase = Object.fromEntries(CASES.map((c) => {
  const rs = rows.filter((r) => r.case === c.key);
  return [c.key, `${rs.filter((r) => r.ok).length}/${rs.length}`];
}));
const problems: Record<string, number> = {};
for (const r of rows) for (const p of r.problems) problems[p] = (problems[p] ?? 0) + 1;
const summary = { label, skills: Boolean(skillTool), systemChars: system.length, ok: `${rows.filter((r) => r.ok).length}/${rows.length}`, byCase, problems };
console.log(JSON.stringify(summary, null, 1));
writeFileSync(`${process.argv[3] ?? "/tmp"}/aimee-draft-${label}.json`, JSON.stringify({ summary, rows }, null, 1));
