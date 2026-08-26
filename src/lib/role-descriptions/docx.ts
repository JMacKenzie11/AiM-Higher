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
import type { getChartFunctionDetail } from "@/lib/chart/service";
import type { RdDocument } from "./generate";

// Word-document generator for the assembled Role Description.
// Mirrors the 10-section layout of the view page but produces a
// .docx that customers can send in offer packets, keep in HR
// records, or print for a coaching conversation.
//
// Uses the `docx` npm package which builds a real .docx buffer
// (not HTML-in-a-fake-container) so it opens cleanly in Word,
// Pages, and Google Docs. Numbering config declared once at the
// document level; sections reference it by reference.

type Detail = NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>;

export async function buildRoleDescriptionDocx(input: {
  detail: Detail;
  companyName: string | null;
  doc: RdDocument | null;
}): Promise<Buffer> {
  const { detail, companyName, doc } = input;
  const responsibilities = detail.roles.filter((r) => !r.is_default);

  const enrichmentByOutcome = new Map<
    string,
    { whyItMatters: string; valuesConnection: string }
  >();
  const enrichmentByResponsibility = new Map<string, string>();
  if (doc) {
    for (const e of doc.outcomeEnrichments) {
      enrichmentByOutcome.set(e.matchTitle, {
        whyItMatters: e.whyItMatters,
        valuesConnection: e.valuesConnection,
      });
    }
    for (const e of doc.responsibilityEnrichments) {
      enrichmentByResponsibility.set(e.matchTitle, e.strategicContext);
    }
  }

  const paragraphs: Paragraph[] = [];

  // 1 · Job Title (H1) + subtitle (company · parent function)
  paragraphs.push(
    new Paragraph({
      text: detail.fn.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
    })
  );
  const subtitleParts: string[] = [];
  if (companyName) subtitleParts.push(companyName);
  if (detail.parent) subtitleParts.push(`Part of ${detail.parent.title}`);
  if (subtitleParts.length > 0) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: subtitleParts.join(" · "),
            italics: true,
            color: "6b7280",
          }),
        ],
        spacing: { after: 300 },
      })
    );
  }

  // 2 · Position Summary
  if (doc?.positionSummary) {
    paragraphs.push(sectionHeading("Position Summary"));
    for (const p of splitParagraphs(doc.positionSummary)) {
      paragraphs.push(bodyParagraph(p));
    }
  }

  // 3 · Core Success Outcomes
  if (detail.outcomes.length > 0) {
    paragraphs.push(sectionHeading("Core Success Outcomes"));
    detail.outcomes.forEach((o, idx) => {
      const enrichment = enrichmentByOutcome.get(o.title);
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${idx + 1}. ${o.title}`,
              bold: true,
              size: 26,
            }),
          ],
          spacing: { before: 200, after: 60 },
        })
      );
      const why = enrichment?.whyItMatters || o.description;
      if (why) paragraphs.push(bodyParagraph(why));
      if (enrichment?.valuesConnection) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: enrichment.valuesConnection,
                italics: true,
                color: "6b7280",
              }),
            ],
            spacing: { after: 100 },
          })
        );
      }
    });
  }

  // 4 · Outcomes and their Key Success Measures
  if (detail.outcomes.some((o) => o.measures.length > 0)) {
    paragraphs.push(sectionHeading("Outcomes"));
    for (const o of detail.outcomes) {
      if (o.measures.length === 0) continue;
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: o.title,
              bold: true,
              allCaps: true,
              size: 20,
              color: "374151",
            }),
          ],
          spacing: { before: 160, after: 40 },
        })
      );
      for (const m of o.measures) {
        const text = m.target
          ? `${m.description} — target ${m.target}`
          : m.description;
        paragraphs.push(bullet(text));
      }
    }
  }

  // 5 · Key Responsibilities
  if (responsibilities.length > 0) {
    paragraphs.push(sectionHeading("Key Responsibilities"));
    for (const r of responsibilities) {
      const context = enrichmentByResponsibility.get(r.title);
      paragraphs.push(bulletBoldLead(r.title));
      if (context) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: context,
                color: "4b5563",
              }),
            ],
            indent: { left: 720 },
            spacing: { after: 120 },
          })
        );
      }
    }
  }

  // 6 · Decision Rights
  if (detail.decisionRights.length > 0) {
    paragraphs.push(sectionHeading("Decision Rights"));
    for (const d of detail.decisionRights) {
      paragraphs.push(bulletBoldLead(d.title, d.body));
    }
  }

  // 7 · Strengths & Expertise
  if (doc && hasStrengths(doc)) {
    paragraphs.push(sectionHeading("Strengths & Expertise"));
    const s = doc.strengthsAndExpertise;
    if (s.technical.length > 0) {
      paragraphs.push(subBlockLabel("Technical"));
      for (const item of s.technical) paragraphs.push(bullet(item));
    }
    if (s.strategic.length > 0) {
      paragraphs.push(subBlockLabel("Strategic"));
      for (const item of s.strategic) paragraphs.push(bullet(item));
    }
    if (s.interpersonal.length > 0) {
      paragraphs.push(subBlockLabel("Interpersonal"));
      for (const item of s.interpersonal) paragraphs.push(bullet(item));
    }
    if (s.accountability) {
      paragraphs.push(subBlockLabel("Ownership"));
      paragraphs.push(bodyParagraph(s.accountability));
    }
  }

  // 8 · Competency Indicators
  if (detail.competencies.length > 0) {
    paragraphs.push(sectionHeading("Competency Indicators"));
    for (const c of detail.competencies) {
      paragraphs.push(bulletBoldLead(c.title, c.body));
    }
  }

  // 9 · Qualifications
  if (doc && hasQualifications(doc)) {
    paragraphs.push(sectionHeading("Qualifications"));
    const q = doc.qualifications;
    if (q.experience) {
      paragraphs.push(subBlockLabel("Experience"));
      paragraphs.push(bodyParagraph(q.experience));
    }
    if (q.education) {
      paragraphs.push(subBlockLabel("Education"));
      paragraphs.push(bodyParagraph(q.education));
    }
    if (q.certifications) {
      paragraphs.push(subBlockLabel("Certifications"));
      paragraphs.push(bodyParagraph(q.certifications));
    }
  }

  // 10 · Why This Role Matters
  if (doc?.whyThisRoleMatters) {
    paragraphs.push(sectionHeading("Why This Role Matters"));
    for (const p of splitParagraphs(doc.whyThisRoleMatters)) {
      paragraphs.push(bodyParagraph(p));
    }
  }

  const document = new Document({
    creator: "AiMHigher",
    title: `Role Description — ${detail.fn.title}`,
    description: companyName
      ? `Role description for ${detail.fn.title} at ${companyName}`
      : `Role description for ${detail.fn.title}`,
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 },
        },
      },
    },
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    children: ["Page ", PageNumber.CURRENT],
                    color: "9ca3af",
                    size: 18,
                  }),
                ],
              }),
            ],
          }),
        },
        children: paragraphs,
      },
    ],
  });

  return Packer.toBuffer(document);
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 120 },
  });
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text })],
    spacing: { after: 120 },
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text })],
    bullet: { level: 0 },
    spacing: { after: 60 },
  });
}

function bulletBoldLead(lead: string, trailing?: string | null): Paragraph {
  const children: TextRun[] = [new TextRun({ text: lead, bold: true })];
  if (trailing) {
    children.push(new TextRun({ text: `: ${trailing}` }));
  }
  return new Paragraph({
    children,
    bullet: { level: 0 },
    spacing: { after: 80 },
  });
}

function subBlockLabel(label: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: label,
        bold: true,
        allCaps: true,
        color: "6b7280",
        size: 18,
      }),
    ],
    spacing: { before: 160, after: 40 },
  });
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function hasStrengths(doc: RdDocument): boolean {
  const s = doc.strengthsAndExpertise;
  return (
    s.technical.length > 0 ||
    s.strategic.length > 0 ||
    s.interpersonal.length > 0 ||
    s.accountability.length > 0
  );
}

function hasQualifications(doc: RdDocument): boolean {
  const q = doc.qualifications;
  return !!(q.experience || q.education || q.certifications);
}
