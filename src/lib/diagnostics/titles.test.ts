import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validateTitles } from "./titles";

describe("validateTitles", () => {
  it("keeps one name per known task, cleaned", () => {
    const out = validateTitles(
      {
        titles: [
          { id: "a", canonical_title: "  Quoting  " },
          { id: "a", canonical_title: "Second answer" },
          { id: "b", canonical_title: "Order entry — daily" },
          { id: "zzz", canonical_title: "Not asked for" },
          { id: "c", canonical_title: "   " },
          { id: 7, canonical_title: "Not an id" },
        ],
      },
      ["a", "b", "c"]
    );
    expect([...out.entries()]).toEqual([
      ["a", "Quoting"],
      ["b", "Order entry, daily"],
    ]);
  });

  it("reads nothing from the wrong shape", () => {
    expect(validateTitles(null, ["a"]).size).toBe(0);
    expect(validateTitles({ titles: "Quoting" }, ["a"]).size).toBe(0);
  });
});
