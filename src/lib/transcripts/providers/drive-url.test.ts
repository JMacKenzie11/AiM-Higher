import { describe, it, expect } from "vitest";
import { parseGoogleFolderId } from "./drive-url";

// This module exists to stay dependency-free: it was split out of
// google-drive.ts so importing the parser doesn't pull in the
// `googleapis` package. The behaviour below is unchanged from the
// original implementation — these tests pin it so the move is provably
// behaviour-preserving.

describe("parseGoogleFolderId", () => {
  it("accepts a bare folder id", () => {
    expect(parseGoogleFolderId("1A2b3C4d5E6f7G8h9I0j")).toBe(
      "1A2b3C4d5E6f7G8h9I0j"
    );
  });

  it("extracts the id from a /folders/ URL", () => {
    expect(
      parseGoogleFolderId(
        "https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0j"
      )
    ).toBe("1A2b3C4d5E6f7G8h9I0j");
  });

  it("extracts the id from a /folders/ URL carrying query params", () => {
    expect(
      parseGoogleFolderId(
        "https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0j?usp=sharing"
      )
    ).toBe("1A2b3C4d5E6f7G8h9I0j");
  });

  it("extracts the id from an ?id= style URL", () => {
    expect(
      parseGoogleFolderId(
        "https://drive.google.com/open?id=1A2b3C4d5E6f7G8h9I0j"
      )
    ).toBe("1A2b3C4d5E6f7G8h9I0j");
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseGoogleFolderId("  1A2b3C4d5E6f7G8h9I0j  ")).toBe(
      "1A2b3C4d5E6f7G8h9I0j"
    );
  });

  it("returns null for empty, whitespace, and unparseable input", () => {
    expect(parseGoogleFolderId("")).toBeNull();
    expect(parseGoogleFolderId("   ")).toBeNull();
    expect(parseGoogleFolderId("not-a-drive-url")).toBeNull();
    expect(parseGoogleFolderId("https://example.com/folders/")).toBeNull();
  });

  it("rejects an id shorter than the 20-character minimum", () => {
    // Guards against treating a stray word as a folder id.
    expect(parseGoogleFolderId("shortid123")).toBeNull();
  });
});
