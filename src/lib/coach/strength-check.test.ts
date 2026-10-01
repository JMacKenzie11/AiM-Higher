import { describe, it, expect, vi } from "vitest";
import { mightNameAStrength, readVerdict, skippedStrength } from "./strength-check";

const reply = (text: string) => ({ content: [{ type: "text", text }] });

describe("the named-strength check", () => {
  it("runs only when the message has a turn in it", () => {
    expect(mightNameAStrength("Our warehouse manager is great with the crew but terrible at paperwork")).toBe(true);
    expect(mightNameAStrength("I'm having a problem with someone on my team")).toBe(false);
  });

  it("reads the verdict, and anything unreadable counts as acknowledged", () => {
    expect(readVerdict('{"strength": "great with the crew", "acknowledged": false}')).toEqual({ strength: "great with the crew", acknowledged: false });
    expect(readVerdict('{"strength": null, "acknowledged": false}')).toEqual({ strength: null, acknowledged: true });
    expect(readVerdict("I think so")).toEqual({ strength: null, acknowledged: true });
  });

  it("returns the strength a reply skipped", async () => {
    const usage = { input_tokens: 210, output_tokens: 18 };
    const create = vi.fn().mockResolvedValue({ ...reply('{"strength": "works harder than anyone", "acknowledged": false}'), usage });
    const onUsage = vi.fn();
    const got = await skippedStrength({ messages: { create } } as never, "He works harder than anyone but he's hopeless at delegating", "What does that look like?", onUsage);
    expect(got).toBe("works harder than anyone");
    expect(onUsage).toHaveBeenCalledWith(usage);
    expect(create.mock.calls[0][1]).toMatchObject({ timeout: 2500, maxRetries: 0 });
  });

  it("fails open when the check errors or times out, and never calls without a turn", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("Request timed out."));
    expect(await skippedStrength({ messages: { create: failing } } as never, "Great with the crew but slow", "What's up?")).toBeNull();
    const unused = vi.fn();
    expect(await skippedStrength({ messages: { create: unused } } as never, "A problem with someone", "What's up?")).toBeNull();
    expect(unused).not.toHaveBeenCalled();
  });
});
