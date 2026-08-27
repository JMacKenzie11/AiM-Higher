import { describe, it, expect } from "vitest";
import { parseVideoUrl, thumbnailUrl, embedUrl } from "./video-url";

// Tests for the classroom video URL parser. The editor's paste
// handler and the "Insert video" toolbar action both rely on this
// returning null for anything that isn't a YouTube or Vimeo share
// URL — if it returns a false positive, the paste handler will
// eat legitimate text.

describe("parseVideoUrl", () => {
  describe("YouTube", () => {
    it("parses standard watch URLs", () => {
      expect(parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
        .toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    });

    it("parses youtu.be shortlinks", () => {
      expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ"))
        .toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    });

    it("parses embed URLs", () => {
      expect(parseVideoUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"))
        .toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    });

    it("parses /shorts/ URLs", () => {
      expect(parseVideoUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"))
        .toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    });

    it("ignores extra query params", () => {
      expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ?t=42&feature=share"))
        .toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    });

    it("handles watch URLs with intervening query params before v=", () => {
      expect(
        parseVideoUrl("https://www.youtube.com/watch?feature=youtu.be&v=dQw4w9WgXcQ")
      ).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    });
  });

  describe("Vimeo", () => {
    it("parses standard vimeo.com/<id> URLs", () => {
      expect(parseVideoUrl("https://vimeo.com/123456789"))
        .toEqual({ provider: "vimeo", id: "123456789" });
    });

    it("parses player.vimeo.com/video/<id> URLs", () => {
      expect(parseVideoUrl("https://player.vimeo.com/video/123456789"))
        .toEqual({ provider: "vimeo", id: "123456789" });
    });

    it("parses /video/ prefix on vimeo.com", () => {
      expect(parseVideoUrl("https://vimeo.com/video/123456789"))
        .toEqual({ provider: "vimeo", id: "123456789" });
    });
  });

  describe("rejects", () => {
    it("returns null for a plain non-URL string", () => {
      expect(parseVideoUrl("this is just some text")).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(parseVideoUrl("")).toBeNull();
      expect(parseVideoUrl("   ")).toBeNull();
    });

    it("returns null for a non-video URL from a supported host", () => {
      // Vimeo channels list, not a specific video.
      expect(parseVideoUrl("https://vimeo.com/channels/staffpicks")).toBeNull();
    });

    it("returns null for other video hosts", () => {
      expect(parseVideoUrl("https://loom.com/share/abc123")).toBeNull();
      expect(parseVideoUrl("https://www.dailymotion.com/video/x8abc12")).toBeNull();
    });
  });
});

describe("thumbnailUrl", () => {
  it("hits YouTube's public thumbnail service for youtube ids", () => {
    expect(thumbnailUrl("youtube", "dQw4w9WgXcQ")).toBe(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    );
  });

  it("hits the vumbnail.com mirror for vimeo ids (no oEmbed round-trip)", () => {
    expect(thumbnailUrl("vimeo", "123456789")).toBe(
      "https://vumbnail.com/123456789.jpg"
    );
  });
});

describe("embedUrl", () => {
  it("uses youtube-nocookie for YouTube (autoplay after click)", () => {
    expect(embedUrl("youtube", "dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&autoplay=1"
    );
  });

  it("uses player.vimeo.com for Vimeo (autoplay after click)", () => {
    expect(embedUrl("vimeo", "123456789")).toBe(
      "https://player.vimeo.com/video/123456789?autoplay=1"
    );
  });
});
