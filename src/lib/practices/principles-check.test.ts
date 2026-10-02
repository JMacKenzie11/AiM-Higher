import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { checkAgentPrompt, principleHeadings, readConflicts } from "./principles-check";

const PRINCIPLES = `# AiMS coaching principles

## Start from what's working

Stay with it.

## Ask one question at a time

One question.`;
const PROMPT = "Start by diagnosing what the leader is doing wrong. Then ask two or three questions to check they agree.";

describe("principleHeadings", () => {
  it("reads the principles' own headings", () => {
    expect(principleHeadings(PRINCIPLES)).toEqual(["Start from what's working", "Ask one question at a time"]);
  });
});

describe("readConflicts holds the model to what code can check", () => {
  const headings = principleHeadings(PRINCIPLES);

  it("keeps a warning that quotes the prompt and names a principle", () => {
    expect(
      readConflicts(
        { conflicts: [{ principle: "ask one question at a time", quote: "ask two or three questions", why: "More than one." }] },
        PROMPT,
        headings
      )
    ).toEqual([{ principle: "Ask one question at a time", quote: "ask two or three questions", why: "More than one." }]);
  });

  it("drops a quote that is not in the prompt, and a principle that does not exist", () => {
    expect(
      readConflicts(
        {
          conflicts: [
            { principle: "Ask one question at a time", quote: "ask several questions at once", why: "Invented." },
            { principle: "Be brief", quote: "diagnosing what the leader is doing wrong", why: "No such principle." },
          ],
        },
        PROMPT,
        headings
      )
    ).toEqual([]);
  });

  it("is null for an answer that is not a list of conflicts", () => {
    expect(readConflicts({ nope: 1 }, PROMPT, headings)).toBeNull();
    expect(readConflicts(null, PROMPT, headings)).toBeNull();
  });
});

describe("checkAgentPrompt", () => {
  const client = (create: (...a: unknown[]) => unknown) => ({ messages: { create } }) as unknown as Anthropic;

  it("sends the principles and the prompt, and returns what checks out", async () => {
    const create = vi.fn(async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            conflicts: [{ principle: "Start from what's working", quote: "diagnosing what the leader is doing wrong", why: "Starts from faults." }],
          }),
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const r = await checkAgentPrompt(client(create), PROMPT, PRINCIPLES);
    expect(r).toEqual({
      status: "checked",
      conflicts: [{ principle: "Start from what's working", quote: "diagnosing what the leader is doing wrong", why: "Starts from faults." }],
    });
    const sent = JSON.stringify((create.mock.calls[0] as unknown[])[0]);
    expect(sent).toContain("Ask one question at a time");
    expect(sent).toContain("ask two or three questions");
  });

  it("says it could not run, rather than calling the prompt clean", async () => {
    expect(await checkAgentPrompt(client(async () => { throw new Error("timeout"); }), PROMPT, PRINCIPLES)).toEqual({ status: "failed", conflicts: [] });
    expect(
      await checkAgentPrompt(client(async () => ({ content: [{ type: "text", text: "not json" }], usage: {} })), PROMPT, PRINCIPLES)
    ).toEqual({ status: "failed", conflicts: [] });
  });
});
