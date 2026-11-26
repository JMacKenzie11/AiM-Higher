// AIMEE'S SKILLS (Jason, 2026-11-26): instructions she loads when she
// needs them, with load_skill, instead of carrying them on every
// message. Each skill is a file in prompts/skills/ with a name and a
// one-line "when"; the system prompt carries only the list.
//
// Pure, so the shape is tested without the file system (skills.ts reads
// the files).

export type Skill = { name: string; when: string; body: string };

const NAME = /^[a-z][a-z0-9_]{1,40}$/;

// "---\nname: x\nwhen: y\n---\nbody". Throws on a malformed file: a
// broken skill should fail the build's tests, not reach a conversation.
export function parseSkill(file: string, text: string): Skill {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) throw new Error(`${file}: no front matter`);
  const fields = Object.fromEntries(
    m[1].split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
  );
  const name = fields.name ?? "";
  const when = fields.when ?? "";
  const body = m[2].trim();
  if (!NAME.test(name)) throw new Error(`${file}: name must be lower_snake_case`);
  if (!when) throw new Error(`${file}: no "when" line`);
  if (!body) throw new Error(`${file}: empty`);
  return { name, when, body };
}

// The list in the system prompt. Sorted by name so it never changes by
// the order files are read in, which would miss the prompt cache.
export function skillIndexBlock(skills: readonly Skill[]): string {
  if (skills.length === 0) return "";
  const lines = [...skills]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => `- ${s.name}: ${s.when}`);
  return [
    "Skills:",
    "",
    "Some instructions are kept as skills, which you load with load_skill when you need them. When a reply needs a skill, load it first, before you write anything in that reply. Load it every time: a skill loaded on an earlier message is no longer in front of you.",
    "",
    ...lines,
    "",
    "Whatever a skill says, a commitment draft is only ever the leader's own, never someone else's, and nothing is saved or added until the leader saves it.",
  ].join("\n");
}

// What load_skill returns.
export function loadSkillResult(skills: readonly Skill[], input: unknown): unknown {
  const name = typeof (input as { name?: unknown })?.name === "string" ? (input as { name: string }).name : "";
  const skill = skills.find((s) => s.name === name);
  if (!skill) return { status: "unknown", known: skills.map((s) => s.name) };
  return { status: "ok", name: skill.name, instructions: skill.body };
}
