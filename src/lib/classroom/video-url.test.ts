import { describe, it, expect } from "vitest";
import {
  parseVideoUrl,
  thumbnailUrl,
  embedUrl,
  upscaleVimeoPoster,
} from "./video-url";

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

// ---- Unlisted Vimeo: the privacy hash ---------------------------
//
// vimeo.com/<id>/<hash> is an UNLISTED video. The hash is not
// decoration: the player refuses the video without it and the
// thumbnail service returns a placeholder, which is what produced a
// grey folder in the editor and "Sorry. We're having a little
// trouble." on the classroom page for a link that plays fine in a
// browser.
describe("unlisted Vimeo URLs carry their privacy hash", () => {
  const real = "https://vimeo.com/1229485592/75fc612f9a";

  it("keeps the hash from a share URL", () => {
    expect(parseVideoUrl(real)).toEqual({
      provider: "vimeo",
      id: "1229485592",
      hash: "75fc612f9a",
    });
  });

  it("keeps it from the player form with ?h=", () => {
    expect(
      parseVideoUrl("https://player.vimeo.com/video/1229485592?h=75fc612f9a")
    ).toEqual({ provider: "vimeo", id: "1229485592", hash: "75fc612f9a" });
  });

  it("omits the hash entirely for a public video", () => {
    // Not `hash: undefined` — absent, so a stored node for a public
    // video is byte-identical to what it was before this change.
    expect(parseVideoUrl("https://vimeo.com/123456789")).toEqual({
      provider: "vimeo",
      id: "123456789",
    });
  });

  it("puts h= on the embed, which is what Vimeo requires", () => {
    expect(embedUrl("vimeo", "1229485592", "75fc612f9a")).toBe(
      "https://player.vimeo.com/video/1229485592?autoplay=1&h=75fc612f9a"
    );
  });

  it("leaves the embed unchanged when there is no hash", () => {
    expect(embedUrl("vimeo", "123456789")).toBe(
      "https://player.vimeo.com/video/123456789?autoplay=1"
    );
    expect(embedUrl("vimeo", "123456789", null)).toBe(
      "https://player.vimeo.com/video/123456789?autoplay=1"
    );
  });

  it("upscales a stored poster that was resolved at the default size", () => {
    // THE BLURRY POSTER. oEmbed answers 295x166 unless asked for a
    // width, and every node stored before we started asking carries
    // that. Stretched to the ~1400px lesson frame it looks broken
    // while being perfectly correct.
    const small =
      "https://i.vimeocdn.com/video/2204155054-6b34ac0f759a349ed508a1d71d772770b8539d32cff829737f3b49caf6370946-d_295x166?region=us";
    const big =
      "https://i.vimeocdn.com/video/2204155054-6b34ac0f759a349ed508a1d71d772770b8539d32cff829737f3b49caf6370946-d_1280?region=us";
    // Not a guess: this rewritten URL was fetched and returns the
    // same 43,333 bytes at 1280x720 that oEmbed hands back for
    // width=1280, against 6,949 bytes at 295x166 for the original.
    expect(upscaleVimeoPoster(small)).toBe(big);
    expect(thumbnailUrl("vimeo", "1229485592", small)).toBe(big);
  });

  it("leaves an already-large poster alone", () => {
    const big =
      "https://i.vimeocdn.com/video/2204155054-b49caf6370946-d_1280?region=us";
    expect(upscaleVimeoPoster(big)).toBe(big);
  });

  it("touches nothing that is not a sized Vimeo CDN poster", () => {
    // A host that merely ENDS in something similar is not Vimeo's,
    // and a poster with no size suffix has nothing to rewrite.
    for (const url of [
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "https://vumbnail.com/123456789.jpg",
      "https://i.vimeocdn.com/video/2204158791-d41047ef.jpg",
      "https://evil.example.com/x-d_295x166",
    ]) {
      expect(upscaleVimeoPoster(url)).toBe(url);
    }
  });

  it("prefers a poster resolved from the provider over the derived one", () => {
    // The derived vumbnail URL CANNOT work for an unlisted video.
    // Measured, not assumed: vumbnail.com/<id>.jpg and
    // vumbnail.com/<id>_<hash>.jpg return byte-identical placeholder
    // images for this video — same md5 — so there is no URL shape
    // that fixes it. The poster has to come from Vimeo's oEmbed and
    // be stored on the node, which is what this argument is.
    const poster = "https://i.vimeocdn.com/video/2204158791-d41047ef.jpg";
    expect(thumbnailUrl("vimeo", "1229485592", poster)).toBe(poster);
  });

  it("falls back to the derived URL when nothing was stored", () => {
    // Every node written before this change, and every public video.
    expect(thumbnailUrl("vimeo", "123456789")).toBe(
      "https://vumbnail.com/123456789.jpg"
    );
    expect(thumbnailUrl("vimeo", "123456789", null)).toBe(
      "https://vumbnail.com/123456789.jpg"
    );
    expect(thumbnailUrl("youtube", "dQw4w9WgXcQ")).toBe(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    );
  });

  it("never invents a hash for YouTube", () => {
    // YouTube has no equivalent, and a trailing path segment there
    // means something else entirely.
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      id: "dQw4w9WgXcQ",
    });
  });
});
