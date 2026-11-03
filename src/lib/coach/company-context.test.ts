import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatCompanyContext } from "./context";

const base = { companyName: "AiMS Institute", foundation: null, coreValues: [], differentiators: [] };

describe("formatCompanyContext: the strategy rides every turn (2026-11-03)", () => {
  it("lists the live focus areas, word for word, and the ideal client profile", () => {
    const block = formatCompanyContext({
      ...base,
      focusAreas: [
        { title: "SFA #1 - Win the Guides: Build and Elevate the Coach Engine", description: null },
        { title: "SFA #2 - Prove the Category", description: "The Capacity Management System" },
      ],
      icpBestFit: ["Owner-led companies of 20 to 200 people"],
      icpPsychographic: ["Owners who want to step back"],
    });
    expect(block).toContain("Strategic focus areas");
    expect(block).toContain("- SFA #1 - Win the Guides: Build and Elevate the Coach Engine");
    expect(block).toContain("- SFA #2 - Prove the Category: The Capacity Management System");
    expect(block).toContain("Best fit: Owner-led companies of 20 to 200 people");
    expect(block).toContain("What they care about: Owners who want to step back");
  });

  it("leaves a section out when the company has none", () => {
    const block = formatCompanyContext(base);
    expect(block).not.toContain("Strategic focus areas");
    expect(block).not.toContain("Ideal client profile");
  });

  it("stays small for a typical company: under 600 tokens with five areas and four profile lines", () => {
    const block = formatCompanyContext({
      ...base,
      focusAreas: Array.from({ length: 5 }, (_, i) => ({ title: `Focus area ${i + 1} with a longer name`, description: "One sentence on what it means for this company this year." })),
      icpBestFit: ["Owner-led companies of 20 to 200 people in construction and trades", "Two or more locations"],
      icpPsychographic: ["Owners who want the business to run without them", "Leaders tired of plans that stall"],
    });
    expect(Math.round(block.length / 3.7)).toBeLessThan(600);
  });
});
