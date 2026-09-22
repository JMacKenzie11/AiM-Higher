import "server-only";

import {
  AlignmentType,
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import type { RoleDescriptionDoc } from "./parse-document";

// The .docx, built from the agent's document.
//
// A second entry point beside buildRoleDescriptionDocx rather than a
// branch inside it. That one takes the Sonnet generator's RdDocument
// AND a chart detail, and reads the function's rows off the detail
// to lay the sections out. Neither is available here: this document
// carries its own sections, and an off-chart role has no function to
// fetch a detail for.
//
// ---- WHY IT STYLES EVERYTHING EXPLICITLY -----------------------
//
// The first version set no styles at all and used docx's
// HeadingLevel constants. Word renders that as Times New Roman with
// its own stock blue headings, no space between paragraphs, and
// every line at one indent — which read as a different product from
// the card it was downloaded from, and worse, as a default nobody
// chose. The card is the reference; this mirrors it.
//
// Nothing here uses HeadingLevel. A heading in this document is a
// run with a size, a weight and a colour, because that is the only
// way to be sure what Word draws: HeadingLevel picks up whatever
// the user's Normal.dotm says a Heading 1 looks like, which on a
// customer's machine is not a decision we made.
//
// Calibri, matching the generator's builder. Inter and Figtree are
// the brand faces and neither is installed on a typical machine, so
// asking for them means Word substitutes something arbitrary. A
// clean sans everybody actually has beats a brand face half the
// readers do not.

const NAVY = "1F3352"; // --aims-navy
const COBALT = "3551A4"; // --aims-cobalt, section headings
const MUTED = "5B6472"; // --text-muted
const BODY_SIZE = 22; // 11pt, in half-points

export async function buildRoleDescriptionDocxFromDoc(input: {
  doc: RoleDescriptionDoc;
  companyName: string | null;
}): Promise<Buffer> {
  const { doc, companyName } = input;
  const paragraphs: Paragraph[] = [];

  // ---- Title block --------------------------------------------
  paragraphs.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: doc.title, bold: true, size: 40, color: NAVY }),
      ],
    })
  );

  const subtitle: string[] = [];
  if (companyName) subtitle.push(companyName);
  if (doc.function) subtitle.push(`Part of ${doc.function.title}`);
  else if (doc.supports_functions.length > 0) {
    subtitle.push(`Supports ${doc.supports_functions.join(", ")}`);
  } else {
    // Said out loud rather than left blank. "Not on the Functional
    // Chart" is a fact about the role that the reader of a printed
    // document cannot otherwise discover.
    subtitle.push("Not on the Functional Chart");
  }
  if (doc.reports_to) subtitle.push(`Reports to ${doc.reports_to}`);
  paragraphs.push(
    new Paragraph({
      spacing: { after: 360 },
      children: [
        new TextRun({
          text: subtitle.join("  ·  "),
          size: 20,
          color: MUTED,
        }),
      ],
    })
  );

  // ---- Builders -----------------------------------------------

  // Uppercase and letter-spaced, which is what the card does with
  // its section labels. `characterSpacing` is in twentieths of a
  // point; 20 is the visual equivalent of the card's 0.08em.
  const heading = (text: string) =>
    paragraphs.push(
      new Paragraph({
        spacing: { before: 360, after: 140 },
        children: [
          new TextRun({
            text: text.toUpperCase(),
            bold: true,
            size: 20,
            color: COBALT,
            characterSpacing: 20,
          }),
        ],
      })
    );

  const para = (text: string) =>
    paragraphs.push(
      new Paragraph({
        spacing: { after: 160, line: 300 },
        children: [new TextRun({ text, size: BODY_SIZE, color: NAVY })],
      })
    );

  // A responsibility or an excellence line: the label on its own
  // line in the heading colour, the body under it in muted grey.
  // Two paragraphs rather than one bold run followed by plain text,
  // so the body wraps under itself instead of under the label.
  const labelled = (label: string, body: string) => {
    paragraphs.push(
      new Paragraph({
        spacing: { before: 140, after: 20 },
        children: [
          new TextRun({ text: label, bold: true, size: BODY_SIZE, color: NAVY }),
        ],
      })
    );
    if (body) {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 60, line: 280 },
          indent: { left: 200 },
          children: [new TextRun({ text: body, size: 20, color: MUTED })],
        })
      );
    }
  };

  const bullet = (text: string) =>
    paragraphs.push(
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 60, line: 280 },
        children: [new TextRun({ text, size: BODY_SIZE, color: NAVY })],
      })
    );

  // ---- Sections -----------------------------------------------

  if (doc.why_this_role_exists.trim()) {
    heading("Why this role exists");
    for (const p of doc.why_this_role_exists.split(/\n{2,}/)) {
      if (p.trim()) para(p.trim());
    }
  }

  if (doc.responsibilities.length > 0) {
    heading("Responsibilities");
    for (const r of doc.responsibilities) labelled(r.category, r.description);
  }

  if (doc.critical_success_factors.length > 0) {
    heading("Critical Success Factors");
    for (const c of doc.critical_success_factors) {
      // "no target set", never "0" and never blank. A factor without
      // a target is an allowed state everywhere else in this product
      // and it must not read as a missed number in a printed doc.
      const target = c.target === null ? "no target set" : c.target;
      paragraphs.push(
        new Paragraph({
          spacing: { before: 140, after: 20 },
          children: [
            new TextRun({
              text: c.description,
              bold: true,
              size: BODY_SIZE,
              color: NAVY,
            }),
            new TextRun({
              text: `   ${target} · ${c.update_frequency}`,
              size: 20,
              color: MUTED,
            }),
          ],
        })
      );
      if (c.why_it_matters) {
        paragraphs.push(
          new Paragraph({
            spacing: { after: 60, line: 280 },
            indent: { left: 200 },
            children: [
              new TextRun({
                text: c.why_it_matters,
                size: 20,
                color: MUTED,
                italics: true,
              }),
            ],
          })
        );
      }
    }
  }

  const rights: Array<[string, string[]]> = [
    ["Decides", doc.decision_rights.decides],
    ["Decides with others", doc.decision_rights.decides_with],
    ["Recommends", doc.decision_rights.recommends],
  ];
  if (rights.some(([, list]) => list.length > 0)) {
    heading("Decision Rights");
    for (const [label, list] of rights) {
      if (list.length === 0) continue;
      paragraphs.push(
        new Paragraph({
          spacing: { before: 140, after: 40 },
          children: [
            new TextRun({ text: label, bold: true, size: 20, color: NAVY }),
          ],
        })
      );
      for (const item of list) bullet(item);
    }
  }

  if (doc.what_excellence_looks_like.length > 0) {
    heading("What excellence looks like");
    for (const e of doc.what_excellence_looks_like) {
      labelled(e.value, e.behaviour);
    }
  }

  if (doc.capabilities.length > 0) {
    heading("Capabilities");
    for (const c of doc.capabilities) bullet(c);
  }

  if (doc.qualifications.length > 0) {
    heading("Qualifications");
    for (const q of doc.qualifications) bullet(q);
  }

  if (doc.why_this_role_matters.trim()) {
    heading("Why this role matters");
    for (const p of doc.why_this_role_matters.split(/\n{2,}/)) {
      if (p.trim()) para(p.trim());
    }
  }

  const document = new Document({
    creator: "AiMHigher",
    title: `Role Description — ${doc.title}`,
    description: companyName
      ? `Role description for ${doc.title} at ${companyName}`
      : `Role description for ${doc.title}`,
    styles: {
      default: {
        document: { run: { font: "Calibri", size: BODY_SIZE, color: NAVY } },
      },
    },
    sections: [
      {
        properties: {},
        children: paragraphs,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    children: ["Page ", PageNumber.CURRENT],
                    color: "9CA3AF",
                    size: 18,
                  }),
                ],
              }),
            ],
          }),
        },
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(document));
}
