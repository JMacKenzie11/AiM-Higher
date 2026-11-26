import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { loadSkillResult, parseSkill, skillIndexBlock } from "./skills-shape";
import { findBannedPhrases } from "@/lib/voice/banned";

vi.mock("server-only", () => ({}));

// Aimee's skills (Jason, 2026-11-26). Every file in prompts/skills/ is a
// well-formed skill that breaks no voice rule; the system prompt lists
// each one; load_skill returns it whole; and the rules that must hold
// even when no skill is loaded are in the list itself.

const files = readdirSync("prompts/skills").filter((f) => f.endsWith(".md"));
const skills = files.map((f) => parseSkill(f, readFileSync(`prompts/skills/${f}`, "utf8")));

describe("Aimee's skills", () => {
  it("are all well formed, with distinct names", () => {
    expect(skills.length).toBeGreaterThan(0);
    expect(new Set(skills.map((s) => s.name)).size).toBe(skills.length);
  });

  it("break no voice rule", () => {
    for (const s of skills) expect(findBannedPhrases(`${s.when}\n${s.body}`), s.name).toEqual([]);
  });

  it("are each named in the list, with when to load it", () => {
    const index = skillIndexBlock(skills);
    for (const s of skills) expect(index).toContain(`- ${s.name}: ${s.when}`);
  });

  it("list the same way whatever order the files are read in", () => {
    expect(skillIndexBlock([...skills].reverse())).toBe(skillIndexBlock(skills));
  });

  it("keep the draft's two hard rules in the list, loaded or not", () => {
    const index = skillIndexBlock(skills);
    expect(index).toMatch(/only ever the leader's own, never someone else's/);
    expect(index).toMatch(/nothing is saved or added until the leader saves it/);
    expect(findBannedPhrases(index)).toEqual([]);
  });

  it("load whole by name, and an unknown name says which exist", () => {
    const draft = skills.find((s) => s.name === "commitment_draft")!;
    expect(loadSkillResult(skills, { name: "commitment_draft" })).toEqual({
      status: "ok",
      name: "commitment_draft",
      instructions: draft.body,
    });
    expect(loadSkillResult(skills, { name: "nope" })).toEqual({ status: "unknown", known: skills.map((s) => s.name) });
    expect(loadSkillResult(skills, null)).toMatchObject({ status: "unknown" });
  });

  it("refuse a malformed file", () => {
    expect(() => parseSkill("x.md", "no front matter")).toThrow();
    expect(() => parseSkill("x.md", "---\nname: Bad Name\nwhen: w\n---\nbody")).toThrow();
    expect(() => parseSkill("x.md", "---\nname: ok_name\n---\nbody")).toThrow();
  });
});
