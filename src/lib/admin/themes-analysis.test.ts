import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { clusterThemes } from "./themes-analysis";
import { anonymiser } from "@/lib/aimee/anonymise";

const anon = anonymiser({ people: ["Marcus Bell"], companies: ["Benson Seafood"] });
const reply = (o: object) => ({ content: [{ type: "text", text: JSON.stringify(o) }] }) as unknown as Anthropic.Message;
const clean = { label: "Hard conversations", count: 6, description: "Leaders preparing to give a report difficult feedback." };
const named = { label: "Marcus and the handoff", count: 2, description: "Leaders at Benson Seafood chasing one person's handoffs." };

describe("clusterThemes, anonymously", () => {
  it("sends named themes back once and keeps the anonymous rewrite", async () => {
    const create = vi.fn().mockResolvedValueOnce(reply({ themes: [clean, named] })).mockResolvedValueOnce(reply({ themes: [clean, { ...named, label: "Missed handoffs", description: "Leaders chasing handoffs that slip." }] }));
    const r = await clusterThemes({ messages: { create } } as unknown as Anthropic, "m", ["1. a title"], anon);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].messages.at(-1).content).toContain("a name");
    expect(r.themes.map((t) => t.label)).toEqual(["Hard conversations", "Missed handoffs"]);
    expect(r.dropped).toBe(0);
  });

  it("drops a theme that still names someone", async () => {
    const create = vi.fn().mockResolvedValue(reply({ themes: [clean, named] }));
    const r = await clusterThemes({ messages: { create } } as unknown as Anthropic, "m", ["1. a title"], anon);
    expect(r.themes).toEqual([clean]);
    expect(r.dropped).toBe(1);
  });
});
