import { splitBold, TEAM_RETURN_LINE, TEAM_STEPS, type VividVisionDoc } from "@/lib/foundation/vivid-vision";

// The Vivid Vision as HTML for Google to convert into a Doc (0318).
//
// Google's import keeps headings, bold, italics, lists, colours and
// font sizes from inline styles, so this is laid out in the PDF's
// order with its navy and orange. The navy band does not survive
// conversion, so the title is navy text with an orange rule. The
// One-Page Plan summary is left out, as in the PDF.

const NAVY = "#0F2A4A";
const ORANGE = "#C97F12";
const INK = "#1D2433";
const MUTED = "#5B6472";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rich = (s: string) =>
  splitBold(s)
    .map((r) => (r.bold ? `<b>${esc(r.text)}</b>` : esc(r.text)))
    .join("")
    .replace(/\n/g, "<br>");

const eyebrow = (text: string) =>
  `<p style="color:${ORANGE};font-size:9pt;font-weight:bold;letter-spacing:1.5pt;margin:18pt 0 2pt 0">${esc(text.toUpperCase())}</p>`;
const h2 = (text: string) => `<h2 style="color:${NAVY};font-size:16pt;margin:0 0 8pt 0">${esc(text)}</h2>`;
const h3 = (text: string) => `<h3 style="color:${NAVY};font-size:12.5pt;margin:12pt 0 4pt 0">${esc(text)}</h3>`;
const p = (html: string, extra = "") => `<p style="color:${INK};font-size:11pt;line-height:1.45;margin:0 0 8pt 0;${extra}">${html}</p>`;
const ul = (items: string[]) => `<ul>${items.map((i) => `<li style="color:${INK};font-size:11pt;margin-bottom:4pt">${rich(i)}</li>`).join("")}</ul>`;

export function visionHtml(doc: VividVisionDoc, companyName: string, year: number): string {
  const out: string[] = [];
  out.push(`<p style="color:${ORANGE};font-size:9pt;font-weight:bold;letter-spacing:1.5pt;margin:0">${esc(`${companyName} · Vivid Vision ${year}`.toUpperCase())}</p>`);
  out.push(`<h1 style="color:${NAVY};font-size:26pt;margin:4pt 0 4pt 0">${esc(doc.title)}</h1>`);
  if (doc.tagline) out.push(p(esc(doc.tagline), `font-style:italic;font-size:13pt;color:${MUTED}`));
  out.push(`<hr style="border:0;border-top:2pt solid #F2A33A">`);

  if (doc.intro.length || doc.story.length) {
    out.push(eyebrow("The Story"));
    for (const para of doc.intro) out.push(p(rich(para)));
    doc.story.forEach((sec, n) => {
      out.push(h3(`${String(n + 1).padStart(2, "0")}  ${sec.headline}`));
      for (const para of sec.paragraphs) out.push(p(rich(para)));
    });
  }

  if (doc.proof.groups.length) {
    out.push(eyebrow("Proof Points"));
    out.push(h2(doc.proof.heading ?? `What ${year} Looks Like`));
    for (const g of doc.proof.groups) {
      if (g.name) out.push(h3(g.name));
      out.push(ul(g.items));
    }
  }

  if (doc.protect.items.length) {
    out.push(eyebrow("What We Protect"));
    out.push(h2(doc.protect.heading ?? "What Never Changes"));
    out.push(ul(doc.protect.items));
  }

  if (doc.themes.items.length) {
    out.push(eyebrow("Strategic Focus Themes"));
    out.push(h2(doc.themes.heading ?? "Where We Put Our Energy"));
    doc.themes.items.forEach((t, n) => {
      out.push(h3(`${n + 1}. ${t.name}`));
      if (t.subtitle) out.push(p(esc(t.subtitle), `color:${ORANGE};font-weight:bold`));
      for (const b of t.body) out.push(p(rich(b)));
    });
  }

  if (doc.closing.length) {
    out.push(`<hr style="border:0;border-top:1pt solid #DDE3EC">`);
    for (const c of doc.closing) out.push(p(rich(c), `font-style:italic;font-weight:bold;font-size:13pt;color:${NAVY}`));
  }

  out.push(eyebrow("Next Steps"));
  out.push(h2("Connecting the Team to the Vision"));
  out.push(
    `<ol>${TEAM_STEPS.map(
      (t) =>
        `<li style="color:${INK};font-size:11pt;margin-bottom:6pt">${esc(t.step)}${
          t.questions ? `<ul>${t.questions.map((q) => `<li style="font-size:11pt"><b>${esc(q)}</b></li>`).join("")}</ul>` : ""
        }</li>`
    ).join("")}</ol>`
  );
  out.push(p(`<b>${esc(TEAM_RETURN_LINE)}</b>`));

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title></head><body style="font-family:Arial,sans-serif">${out.join("\n")}</body></html>`;
}

// The Doc's name in Drive, as the PDF's file name without ".pdf".
export function visionDocName(companyName: string, year: number): string {
  return `${companyName} Vivid Vision ${year}`;
}
