import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { ProposalPdf, type ProposalPdfInput } from "./ProposalPdf";
import { proposalTemplate } from "../proposals";

// The proposal PDF renders as a draft from the template, and signed by
// both, with every mark the editor makes (italic included, which has no
// face of its own in the assets).
const base: ProposalPdfInput = {
  id: "p1",
  series_id: "p1",
  version: 2,
  title: "Capacity Unlocking Engagement",
  sections: proposalTemplate({ ownerName: "Anna Lane", leadName: "Jason Mackenzie" }),
  client_name: null,
  owner_name: null,
  owner_email: null,
  lead_signed_name: null,
  lead_signed_at: null,
  lead_signed_ip: null,
  published_at: null,
  content_hash: null,
  client_signed_name: null,
  client_signed_email: null,
  client_signed_at: null,
  client_signed_ip: null,
  withdrawn_at: null,
};

describe("ProposalPdf", () => {
  it("renders a draft from the template", async () => {
    const pdf = await renderToBuffer(<ProposalPdf p={base} clientName="Precision Communications" ownerName="Anna Lane" />);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it("renders one signed by both, with italic, links and a numbered list", async () => {
    const signed: ProposalPdfInput = {
      ...base,
      sections: [
        ...base.sections,
        {
          key: "terms",
          title: "Terms",
          doc: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "In italic", marks: [{ type: "italic" }, { type: "bold" }] }, { type: "hardBreak" }, { type: "text", text: "a link", marks: [{ type: "link", attrs: { href: "https://aims.example" } }] }] },
              { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] }] },
            ],
          },
        },
      ],
      client_name: "Precision Communications",
      owner_name: "Anna Lane",
      owner_email: "anna@precision.example",
      lead_signed_name: "Jason Mackenzie",
      lead_signed_at: "2026-10-30T14:14:00Z",
      lead_signed_ip: "203.0.113.24",
      published_at: "2026-10-30T14:14:00Z",
      content_hash: "9e41c07a52d8f310b6a2e94d0c71a5e89e41c07a52d8f310b6a2e94d0c71a5e8",
      client_signed_name: "Anna Lane",
      client_signed_email: "anna@precision.example",
      client_signed_at: "2026-11-02T20:41:00Z",
      client_signed_ip: "198.51.100.7",
    };
    const pdf = await renderToBuffer(<ProposalPdf p={signed} clientName="Precision Communications" ownerName="Anna Lane" />);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);
});
