import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/coach/usage", () => ({ usageLogger: () => () => {} }));
vi.mock("@/lib/transcripts/model", () => ({ requestJson: vi.fn() }));

import { skillBody } from "./teach";

describe("skillBody", () => {
  it("numbers the steps and adds what to watch out for", () => {
    expect(skillBody(["Open holabirdsports.com.", " Search for the product asked for. "], ["A sign-up pop-up covers the page; close it."])).toBe(
      "1. Open holabirdsports.com.\n2. Search for the product asked for.\n\nWatch out:\n- A sign-up pop-up covers the page; close it."
    );
  });

  it("leaves Watch out off when nothing got in the way", () => {
    expect(skillBody(["One step."], [])).toBe("1. One step.");
  });
});
