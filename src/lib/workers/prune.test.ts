import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { pruneImages, PRUNED_IMAGE_TEXT } from "./prune";

const shot = (id: string) => ({
  role: "user" as const,
  content: [
    {
      type: "tool_result",
      tool_use_id: id,
      content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: id } }],
    },
  ],
});

describe("pruneImages", () => {
  const messages = [
    { role: "user", content: "the task" },
    shot("a"),
    { role: "assistant", content: [{ type: "text", text: "looking" }] },
    shot("b"),
    shot("c"),
  ] as unknown as Anthropic.MessageParam[];

  it("keeps the newest screenshots and replaces older ones with a line", () => {
    const out = pruneImages(messages, 2) as unknown as Array<{ content: Array<{ content: Array<{ type: string; text?: string }> }> }>;
    expect(out[1].content[0].content[0]).toEqual({ type: "text", text: PRUNED_IMAGE_TEXT });
    expect(out[3].content[0].content[0].type).toBe("image");
    expect(out[4].content[0].content[0].type).toBe("image");
  });

  it("leaves the list it was given alone", () => {
    pruneImages(messages, 0);
    expect(JSON.stringify(messages)).toContain('"data":"a"');
  });

  it("keeps every text message as it was", () => {
    const out = pruneImages(messages, 0);
    expect(out[0]).toBe(messages[0]);
    expect(out[2]).toBe(messages[2]);
  });
});
