import path from "node:path";
import type { ReactNode } from "react";
import { Document, Font, Image, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { fingerprintGroups, proposalStatus, type ProposalDoc, type ProposalRow } from "../proposals";

// A PROPOSAL, AS A PDF (0312; Jason, 2026-10-30, the approved sample).
// No photos: the AiMS logo, white on the navy cover and in colour on
// each page's corner, HQ's navy and chartreuse, Inter and Figtree as the
// readout carries them. The last page is the agreement: both typed
// signatures and the signing record. Rendered on request, never stored;
// a published proposal renders from its frozen row.

const ASSETS = path.join(process.cwd(), "src", "lib", "lead-analysis", "pdf", "assets");

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  Font.register({ family: "Inter", fonts: [400, 600, 700, 800].map((w) => ({ src: path.join(ASSETS, `Inter-${w}.ttf`), fontWeight: w })) });
  // No italic Figtree in the assets: italic text in a section sets
  // upright rather than failing to find a face.
  Font.register({
    family: "Figtree",
    fonts: [400, 600, 700].flatMap((w) => [
      { src: path.join(ASSETS, `Figtree-${w}.ttf`), fontWeight: w },
      { src: path.join(ASSETS, `Figtree-${w}.ttf`), fontWeight: w, fontStyle: "italic" as const },
    ]),
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

const C = { navy: "#1F3352", cobalt: "#3551A4", chartreuse: "#D6E264", midnight: "#11151A", muted: "#5B6472", faint: "#606A77", border: "#E2E4DE", sand: "#F7F7F2" };

const s = StyleSheet.create({
  page: { paddingTop: 84, paddingBottom: 64, paddingHorizontal: 60, fontFamily: "Figtree", fontSize: 10.5, color: C.midnight, lineHeight: 1.5 },
  hdrLogo: { position: "absolute", top: 26, left: 60, width: 34, height: 34 },
  hdrText: { position: "absolute", top: 39, right: 60, fontFamily: "Inter", fontSize: 7.5, fontWeight: 700, letterSpacing: 1.4, color: C.muted, textTransform: "uppercase" },
  foot: { position: "absolute", bottom: 28, left: 60, right: 60, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.75, borderTopColor: C.border, paddingTop: 8, fontFamily: "Inter", fontSize: 7.5, color: C.faint },
  h2: { fontFamily: "Inter", fontSize: 15, fontWeight: 800, color: C.navy },
  rule: { width: 36, height: 3, backgroundColor: C.chartreuse, marginTop: 5, marginBottom: 10 },
  section: { marginBottom: 22 },
  p: { marginBottom: 6 },
  li: { flexDirection: "row", marginBottom: 4 },
  bullet: { width: 14, color: C.cobalt, fontWeight: 700 },
  liBody: { flex: 1 },
  label: { fontFamily: "Inter", fontSize: 7.5, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", color: C.muted, marginBottom: 3 },
  link: { color: C.cobalt, textDecoration: "underline" },
  draft: { position: "absolute", top: 39, left: 110, fontFamily: "Inter", fontSize: 7.5, fontWeight: 800, letterSpacing: 1.4, color: "#8D6222", textTransform: "uppercase" },
  cover: { backgroundColor: C.navy, color: "#FFFFFF", padding: 60, fontFamily: "Figtree", justifyContent: "space-between" },
  coverLogo: { width: 120, height: 120 },
  kick: { fontFamily: "Inter", fontSize: 9, fontWeight: 700, letterSpacing: 2.4, color: C.chartreuse, textTransform: "uppercase", marginBottom: 10 },
  big: { fontFamily: "Inter", fontSize: 38, fontWeight: 800, lineHeight: 1.1 },
  client: { fontSize: 16, fontWeight: 600, color: "#D9DEEA", marginTop: 14 },
  band: { width: 150, height: 6, backgroundColor: C.chartreuse, marginTop: 22 },
  prepared: { fontSize: 10.5, color: "#B9C2D3", marginTop: 26, lineHeight: 1.5 },
  coverFoot: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.75, borderTopColor: "#34507A", paddingTop: 10, fontFamily: "Inter", fontSize: 8, color: "#B9C2D3" },
  sigRow: { flexDirection: "row", gap: 28, marginTop: 18 },
  sigCol: { flex: 1 },
  sig: { fontFamily: "Figtree", fontSize: 20, fontWeight: 600, color: C.navy, borderBottomWidth: 1, borderBottomColor: C.midnight, paddingBottom: 4, marginBottom: 6, minHeight: 34 },
  bold: { fontWeight: 700 },
  muted: { color: C.muted },
  audit: { marginTop: 34, borderWidth: 1, borderColor: C.border, borderRadius: 4, padding: 12, backgroundColor: C.sand },
  auditRow: { flexDirection: "row", marginBottom: 4, fontSize: 8.5 },
  auditK: { width: 110, color: C.muted },
  auditV: { flex: 1 },
});

// The editor's document, drawn. Keep in step with cleanDoc's nodes.
function inline(nodes: ProposalDoc[] | undefined, key: string): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    const k = `${key}.${i}`;
    if (n.type === "hardBreak") return <Text key={k}>{"\n"}</Text>;
    if (n.type !== "text") return null;
    const marks = new Set((n.marks ?? []).map((m) => m.type));
    const style = {
      ...(marks.has("bold") ? { fontWeight: 700 } : {}),
      ...(marks.has("italic") ? { fontStyle: "italic" as const } : {}),
      ...(marks.has("underline") ? { textDecoration: "underline" as const } : {}),
      ...(marks.has("strike") ? { textDecoration: "line-through" as const } : {}),
    };
    const href = n.marks?.find((m) => m.type === "link")?.attrs?.href;
    if (typeof href === "string") {
      return (
        <Link key={k} src={href} style={[s.link, style]}>
          {n.text}
        </Link>
      );
    }
    return (
      <Text key={k} style={style}>
        {n.text}
      </Text>
    );
  });
}

function blocks(nodes: ProposalDoc[] | undefined, key: string): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    const k = `${key}.${i}`;
    if (n.type === "paragraph") {
      return (
        <Text key={k} style={s.p}>
          {inline(n.content, k)}
        </Text>
      );
    }
    if (n.type === "bulletList" || n.type === "orderedList") {
      const start = typeof n.attrs?.start === "number" ? n.attrs.start : 1;
      return (
        <View key={k} style={{ marginBottom: 6 }}>
          {(n.content ?? []).map((item, j) => (
            <View key={`${k}.${j}`} style={s.li} wrap={false}>
              <Text style={s.bullet}>{n.type === "bulletList" ? "•" : `${start + j}.`}</Text>
              <View style={s.liBody}>{blocks(item.content, `${k}.${j}`)}</View>
            </View>
          ))}
        </View>
      );
    }
    return null;
  });
}

const longDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" }) : "";
const stamp = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-CA", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Toronto", timeZoneName: "short" }) : "";

export type ProposalPdfInput = Omit<ProposalRow, "client_id" | "created_at" | "updated_at">;

export function ProposalPdf({ p, clientName, ownerName }: { p: ProposalPdfInput; clientName: string; ownerName: string | null }) {
  registerFonts();
  const status = proposalStatus(p);
  const client = p.client_name ?? clientName;
  const owner = p.owner_name ?? ownerName;
  const when = longDate(p.published_at ?? new Date().toISOString());
  const Chrome = () => (
    <>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- a react-pdf Image, not an <img>: it has no alt prop */}
      <Image src={path.join(ASSETS, "aims-logo.png")} style={s.hdrLogo} fixed />
      {status === "draft" ? (
        <Text style={s.draft} fixed>
          Draft, not signed
        </Text>
      ) : null}
      <Text style={s.hdrText} fixed>
        {`${client} · Proposal · Version ${p.version}`}
      </Text>
      <View style={s.foot} fixed>
        <Text>AiMS HQ</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </>
  );
  return (
    <Document title={`${p.title}, ${client}`} author="AiMS Institute">
      <Page size="LETTER" style={s.cover}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- a react-pdf Image, not an <img>: it has no alt prop */}
        <Image src={path.join(ASSETS, "aims-logo-reversed.png")} style={s.coverLogo} />
        <View>
          <Text style={s.kick}>{status === "draft" ? "Draft proposal" : "Proposal"}</Text>
          <Text style={s.big}>{p.title}</Text>
          <Text style={s.client}>{client}</Text>
          <View style={s.band} />
          {owner ? <Text style={s.prepared}>{`Prepared for ${owner}`}</Text> : null}
        </View>
        <View style={s.coverFoot}>
          <Text>AiMS HQ</Text>
          <Text>{`Version ${p.version} · ${when}`}</Text>
        </View>
      </Page>

      <Page size="LETTER" style={s.page}>
        <Chrome />
        {p.sections.map((sec) => (
          <View key={sec.key} style={s.section}>
            <View wrap={false}>
              <Text style={s.h2}>{sec.title}</Text>
              <View style={s.rule} />
            </View>
            {blocks(sec.doc.content, sec.key)}
          </View>
        ))}
      </Page>

      <Page size="LETTER" style={s.page}>
        <Chrome />
        <View style={s.section}>
          <Text style={s.h2}>Agreement</Text>
          <View style={s.rule} />
          <Text style={s.p}>{`By signing below, AiMS Institute and ${client} agree to version ${p.version} of this proposal, as set out on the previous pages.`}</Text>
          <View style={s.sigRow}>
            <View style={s.sigCol}>
              <Text style={s.label}>For AiMS Institute</Text>
              <Text style={s.sig}>{p.lead_signed_name ?? ""}</Text>
              <Text style={s.bold}>{p.lead_signed_name ?? "Not signed yet"}</Text>
              <Text style={s.muted}>{p.lead_signed_at ? `Signed ${longDate(p.lead_signed_at)}` : " "}</Text>
            </View>
            <View style={s.sigCol}>
              <Text style={s.label}>{`For ${client}`}</Text>
              <Text style={s.sig}>{p.client_signed_name ?? ""}</Text>
              <Text style={s.bold}>{p.client_signed_name ?? owner ?? "Not signed yet"}</Text>
              <Text style={s.muted}>{p.client_signed_at ? `Signed ${longDate(p.client_signed_at)}` : "Not signed yet"}</Text>
            </View>
          </View>
          {p.published_at ? (
            <View style={s.audit} wrap={false}>
              <Text style={[s.label, { marginBottom: 8 }]}>Signing record</Text>
              <View style={s.auditRow}>
                <Text style={s.auditK}>Document</Text>
                <Text style={s.auditV}>{`${p.title}, version ${p.version}${status === "replaced" ? " (replaced by a newer version)" : ""}`}</Text>
              </View>
              <View style={s.auditRow}>
                <Text style={s.auditK}>Fingerprint</Text>
                <Text style={s.auditV}>{fingerprintGroups(p.content_hash)}</Text>
              </View>
              <View style={s.auditRow}>
                <Text style={s.auditK}>AiMS signature</Text>
                <Text style={s.auditV}>{[p.lead_signed_name, stamp(p.lead_signed_at), p.lead_signed_ip ? `IP ${p.lead_signed_ip}` : null].filter(Boolean).join(", ")}</Text>
              </View>
              <View style={s.auditRow}>
                <Text style={s.auditK}>Client signature</Text>
                <Text style={s.auditV}>
                  {p.client_signed_at
                    ? [`${p.client_signed_name} (${p.client_signed_email})`, stamp(p.client_signed_at), p.client_signed_ip ? `IP ${p.client_signed_ip}` : null].filter(Boolean).join(", ")
                    : `Waiting for ${owner ?? "the owner"} (${p.owner_email ?? ""})`}
                </Text>
              </View>
              <View style={s.auditRow}>
                <Text style={s.auditK}>Method</Text>
                <Text style={s.auditV}>Typed name, signed in to AiMS HQ, agreement box ticked</Text>
              </View>
            </View>
          ) : null}
        </View>
      </Page>
    </Document>
  );
}
