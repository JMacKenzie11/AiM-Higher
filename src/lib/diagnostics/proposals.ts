// PROPOSALS (0312; Jason, 2026-10-30, the approved mockup and sample
// PDF). A proposal for a Capacity Diagnostic client in set sections,
// each a small rich text document (TipTap JSON, the notes editor's
// marks and lists). Pure: the template, the status a row is in, and the
// checks before publishing. No database, no React.

export type ProposalDoc = { type: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; text?: string; content?: ProposalDoc[] };

export type ProposalSection = { key: string; title: string; doc: ProposalDoc };

export type ProposalRow = {
  id: string;
  client_id: string;
  series_id: string;
  version: number;
  title: string;
  sections: ProposalSection[];
  client_name: string | null;
  owner_name: string | null;
  owner_email: string | null;
  lead_signed_name: string | null;
  lead_signed_at: string | null;
  lead_signed_ip: string | null;
  published_at: string | null;
  content_hash: string | null;
  client_signed_name: string | null;
  client_signed_email: string | null;
  client_signed_at: string | null;
  client_signed_ip: string | null;
  withdrawn_at: string | null;
  created_at: string;
  updated_at: string;
};

export const PROPOSAL_COLUMNS =
  "id, client_id, series_id, version, title, sections, client_name, owner_name, owner_email, lead_signed_name, lead_signed_at, lead_signed_ip, published_at, content_hash, client_signed_name, client_signed_email, client_signed_at, client_signed_ip, withdrawn_at, created_at, updated_at";

export const PROPOSAL_TITLE = "Capacity Unlocking Engagement";

// Where a version stands. Replaced: withdrawn by a newer version.
export type ProposalStatus = "draft" | "waiting" | "signed" | "replaced";

export function proposalStatus(p: Pick<ProposalRow, "published_at" | "client_signed_at" | "withdrawn_at">): ProposalStatus {
  if (!p.published_at) return "draft";
  if (p.withdrawn_at) return "replaced";
  return p.client_signed_at ? "signed" : "waiting";
}

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Draft",
  waiting: "Waiting for signature",
  signed: "Signed",
  replaced: "Replaced",
};

// ---- Building documents ----------------------------------------------

type Run = string | { b: string };

function text(runs: Run[]): ProposalDoc[] {
  return runs
    .map((r) => (typeof r === "string" ? { type: "text", text: r } : { type: "text", text: r.b, marks: [{ type: "bold" }] }))
    .filter((n) => n.text.length > 0);
}

const para = (...runs: Run[]): ProposalDoc => {
  const content = text(runs);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

const bullets = (items: Run[][]): ProposalDoc => ({
  type: "bulletList",
  content: items.map((runs) => ({ type: "listItem", content: [para(...runs)] })),
});

const doc = (...content: ProposalDoc[]): ProposalDoc => ({ type: "doc", content });

// ---- The template ----------------------------------------------------

// The sections, in the order they print. A bracketed [placeholder] is
// for the lead to fill; publishing waits until none is left.
export const PROPOSAL_SECTION_KEYS = ["involved", "objective", "outcomes", "scope", "plan", "investment", "terms"] as const;

export function proposalTemplate(input: { ownerName: string | null; leadName: string }): ProposalSection[] {
  return [
    {
      key: "involved",
      title: "Who's involved",
      doc: doc(
        para({ b: "Attention: " }, input.ownerName?.trim() || "[Owner name and title]"),
        para({ b: "The AiMS team: " }, input.leadName.trim() || "[Your name and role]"),
        para({ b: "Your core team: " }, "[The people on your side who will work with us]")
      ),
    },
    {
      key: "objective",
      title: "Objective",
      doc: doc(
        para(
          "To give your team back hours every week by building bots for the routine work that slows them down, and to measure every one, so you see exactly what each bot saves."
        )
      ),
    },
    {
      key: "outcomes",
      title: "Key outcomes",
      doc: doc(
        bullets([
          ["The first bot live and measured within three weeks."],
          ["A 90-day roadmap of the next bots, in order of hours saved."],
          ["Every bot on the roadmap deployed, monitored, and reported on weekly."],
          ["Support until the results agreed at the readout are realized."],
        ])
      ),
    },
    {
      key: "scope",
      title: "Scope",
      doc: doc(
        para({ b: "Participants: " }, "[Who takes part]"),
        para({ b: "Term: " }, "[Start date] to [end date]"),
        para({ b: "Where: " }, "[Remote, on site, or both]")
      ),
    },
    {
      key: "plan",
      title: "High-level plan",
      doc: doc(
        para("The engagement runs in four stages. You can follow each one in your AiMS HQ portal."),
        bullets([
          [
            { b: "Capacity Diagnostic, weeks 1 to 3: " },
            "we secure access to your tools and walk through your systems, how information moves between them, and the recurring work done in them. We agree the scope and your Capacity Destination, where the hours we free up should go. Then we build the first bot, put it in use, and measure what it saves.",
          ],
          [
            { b: "Your readout: " },
            "the first bot measured, hours back measured and projected, your systems map, the next bots in order of hours saved, the recommended bot team, the guardrails each bot works within, and a 90-day roadmap.",
          ],
          [
            { b: "Deployment: " },
            "we build and launch the bots on the roadmap. Each one moves from Planned to Building to Testing to Live, with a champion on your team.",
          ],
          [
            { b: "Support: " },
            "we monitor every run, and if a bot is late or stops, we know and act on it. Your portal shows hours saved each week, in total, and in dollars at the agreed rate. Each bot carries a 60 day warranty from the day it goes live.",
          ],
        ]),
        para({ b: "Our commitment: " }, "support continues until the results we agree at the readout are realized.")
      ),
    },
    {
      key: "investment",
      title: "Investment and payment",
      doc: doc(para({ b: "Investment: " }, "[The fee for the engagement]"), para({ b: "Payment: " }, "[How and when it is paid]")),
    },
    {
      key: "terms",
      title: "Terms",
      doc: doc(
        para(
          { b: "Travel expenses: " },
          "the client reimburses travel expenses as incurred for up to one AiMS team member, including all travel to and from any in-person venue (hotel, meals, rental car). For flights over 2 hours, preferred seating is included."
        ),
        para({ b: "Additional services: " }, "quotes provided on request.")
      ),
    },
  ];
}

// ---- Reading documents -----------------------------------------------

// The plain text of a document, paragraphs and list items on their own
// lines.
export function docText(d: ProposalDoc | null | undefined): string {
  if (!d) return "";
  if (d.type === "text") return d.text ?? "";
  if (d.type === "hardBreak") return "\n";
  const inner = (d.content ?? []).map(docText).join(d.type === "doc" || d.type === "bulletList" || d.type === "orderedList" || d.type === "listItem" ? "\n" : "");
  return inner;
}

// Every [placeholder] still in the proposal, with its section.
export function placeholdersIn(sections: ProposalSection[]): Array<{ section: string; text: string }> {
  return sections.flatMap((s) => [...docText(s.doc).matchAll(/\[[^\]\n]{1,80}\]/g)].map((m) => ({ section: s.title, text: m[0] })));
}

// What stops a draft from being signed and published, or null.
export function publishBlocker(p: { title: string; sections: ProposalSection[] }, ownerEmail: string | null): string | null {
  if (!p.title.trim()) return "Give the proposal a title.";
  if (!ownerEmail?.trim()) return "Add the owner's email on the client first. The owner signs with the login for that email.";
  const left = placeholdersIn(p.sections);
  if (left.length) {
    const first = left[0];
    return left.length === 1
      ? `Fill in ${first.text} in ${first.section} first.`
      : `Fill in the ${left.length} bracketed placeholders first, starting with ${first.text} in ${first.section}.`;
  }
  if (p.sections.every((s) => !docText(s.doc).trim())) return "Write the proposal first.";
  return null;
}

// Only the nodes and marks the editor makes survive a save, so a
// pasted document cannot carry anything the page or the PDF would not
// show.
const NODES = new Set(["doc", "paragraph", "text", "bulletList", "orderedList", "listItem", "hardBreak"]);
const MARKS = new Set(["bold", "italic", "underline", "strike", "link"]);

export function cleanDoc(d: unknown, depth = 0): ProposalDoc | null {
  if (!d || typeof d !== "object" || depth > 12) return null;
  const n = d as ProposalDoc;
  if (typeof n.type !== "string" || !NODES.has(n.type)) return null;
  if (n.type === "text") {
    if (typeof n.text !== "string" || !n.text) return null;
    const marks = (Array.isArray(n.marks) ? n.marks : [])
      .filter((m) => m && MARKS.has(m.type))
      .map((m) => {
        if (m.type !== "link") return { type: m.type };
        const href = typeof m.attrs?.href === "string" ? m.attrs.href : "";
        return /^(https?:|mailto:)/i.test(href) ? { type: "link", attrs: { href: href.slice(0, 2000) } } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    return marks.length ? { type: "text", text: n.text.slice(0, 20000), marks } : { type: "text", text: n.text.slice(0, 20000) };
  }
  const content = (Array.isArray(n.content) ? n.content : []).map((c) => cleanDoc(c, depth + 1)).filter((c): c is ProposalDoc => c !== null);
  const attrs = n.type === "orderedList" && typeof n.attrs?.start === "number" ? { start: n.attrs.start } : undefined;
  return { type: n.type, ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) };
}

export function isProposalSections(v: unknown): v is ProposalSection[] {
  return Array.isArray(v) && v.every((s) => s && typeof s === "object" && typeof s.key === "string" && typeof s.title === "string" && s.doc && typeof s.doc === "object");
}

// The fingerprint as printed: groups of four, so it can be read aloud.
export function fingerprintGroups(hash: string | null): string {
  return (hash ?? "").replace(/(.{4})/g, "$1 ").trim();
}
