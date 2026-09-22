import "server-only";

import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
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
// fetch a detail for. Folding two sources into one function would
// mean a builder where half the parameters are null on every call.
//
// The page furniture is deliberately identical — same title block,
// same company subtitle, same page numbers in the footer — so a file
// from the agent and a file from the generator open looking like the
// same product.

export async function buildRoleDescriptionDocxFromDoc(input: {
  doc: RoleDescriptionDoc;
  companyName: string | null;
}): Promise<Buffer> {
  const { doc, companyName } = input;
  const paragraphs: Paragraph[] = [];

  paragraphs.push(
    new Paragraph({
      text: doc.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
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
      children: [new TextRun({ text: subtitle.join(" · "), italics: true })],
    })
  );

  const heading = (text: string) =>
    paragraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1 }));
  const body = (text: string) =>
    paragraphs.push(new Paragraph({ text }));
  const bullet = (text: string) =>
    paragraphs.push(new Paragraph({ text, bullet: { level: 0 } }));

  if (doc.why_this_role_exists) {
    heading("Why this role exists");
    for (const para of doc.why_this_role_exists.split(/\n{2,}/)) {
      if (para.trim()) body(para.trim());
    }
  }

  if (doc.responsibilities.length > 0) {
    heading("Responsibilities");
    for (const r of doc.responsibilities) {
      bullet(r.description ? `${r.category}: ${r.description}` : r.category);
    }
  }

  if (doc.critical_success_factors.length > 0) {
    heading("Critical Success Factors");
    for (const c of doc.critical_success_factors) {
      // "no target set", never "0" and never blank. A factor without
      // a target is an allowed state everywhere else in this product
      // and it must not read as a missed number in a printed doc.
      const target = c.target === null ? "no target set" : c.target;
      bullet(`${c.description} — ${target}, ${c.update_frequency}`);
      if (c.why_it_matters) body(c.why_it_matters);
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
      body(label);
      for (const item of list) bullet(item);
    }
  }

  if (doc.what_excellence_looks_like.length > 0) {
    heading("What excellence looks like");
    for (const e of doc.what_excellence_looks_like) {
      bullet(`${e.value}: ${e.behaviour}`);
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

  if (doc.why_this_role_matters) {
    heading("Why this role matters");
    for (const para of doc.why_this_role_matters.split(/\n{2,}/)) {
      if (para.trim()) body(para.trim());
    }
  }

  const document = new Document({
    sections: [
      {
        children: paragraphs,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ children: [PageNumber.CURRENT], size: 18 }),
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
