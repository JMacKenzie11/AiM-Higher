import { describe, expect, it } from "vitest";
import { parseVimeoUrl, vimeoEmbedUrl } from "./vimeo";

describe("parseVimeoUrl", () => {
  it("reads a public video page", () => {
    expect(parseVimeoUrl("https://vimeo.com/1248248696")).toEqual({ id: "1248248696", hash: null });
    expect(parseVimeoUrl(" https://www.vimeo.com/1248248696/?share=copy ")).toEqual({ id: "1248248696", hash: null });
  });

  it("reads an unlisted video's hash, from the page or the player", () => {
    expect(parseVimeoUrl("https://vimeo.com/1248248696/ab12cd34ef")).toEqual({ id: "1248248696", hash: "ab12cd34ef" });
    expect(parseVimeoUrl("https://player.vimeo.com/video/1248248696?h=ab12cd34ef&title=0")).toEqual({
      id: "1248248696",
      hash: "ab12cd34ef",
    });
    expect(parseVimeoUrl("https://player.vimeo.com/video/1248248696")).toEqual({ id: "1248248696", hash: null });
  });

  it("refuses anything that is not a Vimeo video", () => {
    for (const bad of [
      "http://vimeo.com/1248248696",
      "https://vimeo.com.evil.example/1248248696",
      "https://evil.example/vimeo.com/1248248696",
      "https://vimeo.com/channels/staffpicks",
      "https://www.youtube.com/watch?v=abc",
      "vimeo.com/1248248696",
      "",
    ]) {
      expect(parseVimeoUrl(bad), bad).toBeNull();
    }
  });
});

describe("vimeoEmbedUrl", () => {
  it("shows the controls only", () => {
    expect(vimeoEmbedUrl({ id: "1248248696", hash: null })).toBe(
      "https://player.vimeo.com/video/1248248696?title=0&byline=0&portrait=0&badge=0&dnt=1"
    );
  });

  it("carries an unlisted video's hash", () => {
    expect(vimeoEmbedUrl({ id: "1", hash: "ab12" })).toMatch(/^https:\/\/player\.vimeo\.com\/video\/1\?h=ab12&title=0/);
  });
});
