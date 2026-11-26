import "server-only";

import fs from "node:fs";
import path from "node:path";
import { loadSkillResult, parseSkill, skillIndexBlock, type Skill } from "./skills-shape";
import type { CoachTool } from "./tools";

// Reads prompts/skills/*.md once per server instance (skills-shape.ts
// says what a skill is). The folder is bundled for Vercel in
// next.config.ts.
const DIR = path.join(process.cwd(), "prompts", "skills");
let cached: Skill[] | null = null;

export function loadSkills(): Skill[] {
  cached ??= fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parseSkill(f, fs.readFileSync(path.join(DIR, f), "utf8")));
  return cached;
}

export function skillIndex(): string {
  return skillIndexBlock(loadSkills());
}

export function makeLoadSkillTool(): CoachTool {
  const skills = loadSkills();
  return {
    definition: {
      name: "load_skill",
      description:
        "Load one of your skills by name: the instructions for a particular job, listed under Skills in your instructions. Load it right before you do that job, and follow what it returns.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", enum: skills.map((s) => s.name), description: "The skill's name." },
        },
        required: ["name"],
      },
    },
    handler: async (input) => loadSkillResult(skills, input),
  };
}
