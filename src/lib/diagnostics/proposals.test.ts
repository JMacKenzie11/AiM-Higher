import { describe, expect, it } from "vitest";
import { cleanDoc, docText, placeholdersIn, proposalStatus, proposalTemplate, publishBlocker, PROPOSAL_SECTION_KEYS, fingerprintGroups } from "./proposals";

describe("the proposal template", () => {
  const t = proposalTemplate({ ownerName: "Anna Lane", leadName: "Jason Mackenzie" });

  it("has the sections in order, each with a title and a document", () => {
    expect(t.map((s) => s.key)).toEqual([...PROPOSAL_SECTION_KEYS]);
    for (const s of t) expect(docText(s.doc).trim().length).toBeGreaterThan(0);
  });

  it("names the owner and the lead, and follows the four stages", () => {
    expect(docText(t[0].doc)).toContain("Anna Lane");
    expect(docText(t[0].doc)).toContain("Jason Mackenzie");
    const plan = docText(t.find((s) => s.key === "plan")!.doc);
    for (const stage of ["Capacity Diagnostic", "Your readout", "Deployment", "Support"]) expect(plan).toContain(stage);
    expect(plan).toContain("60 day warranty");
    expect(plan).toContain("support continues until the results we agree at the readout are realized");
  });

  it("carries no dashes in its copy", () => {
    expect(t.map((s) => docText(s.doc)).join(" ")).not.toMatch(/[—–]/);
  });

  it("leaves placeholders for the lead, and marks a missing owner as one", () => {
    expect(placeholdersIn(t).map((p) => p.text)).toContain("[The fee for the engagement]");
    const noOwner = proposalTemplate({ ownerName: null, leadName: "" });
    expect(docText(noOwner[0].doc)).toContain("[Owner name and title]");
  });
});

describe("publishBlocker", () => {
  const filled = [{ key: "objective", title: "Objective", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hours back." }] }] } }];

  it("waits for the owner's email, then for every placeholder", () => {
    expect(publishBlocker({ title: "P", sections: filled }, null)).toMatch(/owner's email/);
    const t = proposalTemplate({ ownerName: "Anna", leadName: "Jason" });
    expect(publishBlocker({ title: "P", sections: t }, "a@b.co")).toMatch(/^Fill in the \d+ bracketed placeholders first, starting with/);
    expect(publishBlocker({ title: " ", sections: filled }, "a@b.co")).toBe("Give the proposal a title.");
    expect(publishBlocker({ title: "P", sections: filled }, "a@b.co")).toBeNull();
  });
});

describe("proposalStatus", () => {
  it("reads draft, waiting, signed and replaced", () => {
    expect(proposalStatus({ published_at: null, client_signed_at: null, withdrawn_at: null })).toBe("draft");
    expect(proposalStatus({ published_at: "x", client_signed_at: null, withdrawn_at: null })).toBe("waiting");
    expect(proposalStatus({ published_at: "x", client_signed_at: "y", withdrawn_at: null })).toBe("signed");
    expect(proposalStatus({ published_at: "x", client_signed_at: "y", withdrawn_at: "z" })).toBe("replaced");
  });
});

describe("cleanDoc", () => {
  it("keeps the editor's nodes and marks and drops anything else", () => {
    const d = cleanDoc({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Bold", marks: [{ type: "bold" }, { type: "textStyle", attrs: { color: "red" } }] }] },
        { type: "image", attrs: { src: "https://x" } },
        { type: "paragraph", content: [{ type: "text", text: "link", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
        { type: "paragraph", content: [{ type: "text", text: "ok", marks: [{ type: "link", attrs: { href: "https://aims.example", target: "_blank" } }] }] },
      ],
    });
    expect(d).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Bold", marks: [{ type: "bold" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "link" }] },
        { type: "paragraph", content: [{ type: "text", text: "ok", marks: [{ type: "link", attrs: { href: "https://aims.example" } }] }] },
      ],
    });
    expect(cleanDoc("nope")).toBeNull();
  });
});

describe("fingerprintGroups", () => {
  it("prints the fingerprint in groups of four", () => {
    expect(fingerprintGroups("9e41c07a52d8")).toBe("9e41 c07a 52d8");
    expect(fingerprintGroups(null)).toBe("");
  });
});
