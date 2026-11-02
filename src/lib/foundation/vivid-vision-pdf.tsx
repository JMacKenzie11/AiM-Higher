import "server-only";

import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { splitBold, type VividVisionDoc } from "./vivid-vision";

// THE VIVID VISION, AS A PDF (Jason, 2026-11-02).
//
// Laid out like the two examples Jason supplied (The AiMS Institute and
// NOAH, Vivid Vision 2036): a navy band with the company and year, the
// title and the tagline; the story in numbered sections with a key line
// or two in bold; Proof Points grouped under an orange rule; What We
// Protect on a grey card; the Strategic Focus Themes numbered; a
// closing line. Inter throughout, the examples' navy and orange.
//
// Rendered on request from the saved message, never stored, so a fix to
// the layout reaches every vision the next time it is downloaded.

const ASSETS = path.join(process.cwd(), "src", "lib", "lead-analysis", "pdf", "assets");

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: "Inter",
    fonts: [
      ...[400, 600, 700, 800].map((w) => ({ src: path.join(ASSETS, `Inter-${w}.ttf`), fontWeight: w })),
      { src: path.join(ASSETS, "Inter-400-italic.ttf"), fontWeight: 400, fontStyle: "italic" as const },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

// Sampled from the examples.
const C = {
  navy: "#0F2A4A",
  orange: "#F2A33A",
  orangeText: "#C97F12",
  ink: "#1D2433",
  muted: "#5B6170",
  faint: "#8A909B",
  rule: "#DDE3EC",
  card: "#F4F6FA",
  taglineOnNavy: "#D5DEEA",
  white: "#FFFFFF",
};

const PAD_X = 54;
const PAD_TOP = 48;

const s = StyleSheet.create({
  page: { paddingTop: PAD_TOP, paddingBottom: 60, paddingHorizontal: PAD_X, fontFamily: "Inter", fontSize: 9.5, color: C.ink, backgroundColor: C.white },
  band: { marginTop: -PAD_TOP, marginHorizontal: -PAD_X, backgroundColor: C.navy, paddingHorizontal: PAD_X, paddingTop: 44, paddingBottom: 30, borderBottomWidth: 4, borderBottomColor: C.orange },
  bandEyebrow: { fontSize: 7.5, fontWeight: 700, letterSpacing: 2.2, color: C.orange, textTransform: "uppercase", marginBottom: 10 },
  title: { fontSize: 28, fontWeight: 800, color: C.white, letterSpacing: -0.6, lineHeight: "32pt" },
  tagline: { fontSize: 12.5, fontStyle: "italic", color: C.taglineOnNavy, marginTop: 10 },
  eyebrow: { fontSize: 7, fontWeight: 700, letterSpacing: 2, color: C.orangeText, textTransform: "uppercase", marginBottom: 6 },
  h2: { fontSize: 19, fontWeight: 800, color: C.navy, letterSpacing: -0.3, marginBottom: 14 },
  storyHead: { flexDirection: "row", alignItems: "baseline", marginTop: 14, marginBottom: 5 },
  storyNum: { fontSize: 10.5, fontWeight: 700, color: C.orange, width: 20 },
  storyHeadline: { fontSize: 11.5, fontWeight: 700, color: C.navy, flex: 1 },
  p: { lineHeight: "14.5pt", marginBottom: 7 },
  bold: { fontWeight: 700, color: C.navy },
  divider: { height: 1, backgroundColor: C.rule, marginTop: 18, marginBottom: 18 },
  group: { borderLeftWidth: 3, borderLeftColor: C.orange, paddingLeft: 14, paddingVertical: 2, marginBottom: 14 },
  groupName: { fontSize: 7, fontWeight: 700, letterSpacing: 2, color: C.navy, textTransform: "uppercase", marginBottom: 6 },
  item: { flexDirection: "row", marginBottom: 4 },
  bullet: { width: 3.5, height: 3.5, backgroundColor: C.orange, marginTop: 4.5, marginRight: 7 },
  itemText: { flex: 1, lineHeight: "13.5pt" },
  card: { backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10, marginBottom: 22 },
  protectRow: { paddingVertical: 7, lineHeight: "13.5pt" },
  protectRule: { borderTopWidth: 1, borderTopColor: C.rule },
  theme: { flexDirection: "row", marginBottom: 14 },
  themeNum: { width: 17, height: 17, borderRadius: 8.5, backgroundColor: C.navy, marginRight: 12, alignItems: "center", justifyContent: "center" },
  themeNumText: { fontSize: 8, fontWeight: 700, color: C.white },
  themeName: { fontSize: 11, fontWeight: 700, color: C.navy, marginBottom: 2 },
  themeSubtitle: { fontSize: 9, fontWeight: 600, color: C.orangeText, marginBottom: 5, lineHeight: "12.5pt" },
  closing: { fontSize: 10, fontWeight: 700, color: C.navy, textAlign: "center", lineHeight: "15pt" },
  footer: { position: "absolute", bottom: 26, left: PAD_X, right: PAD_X, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.faint },
});

// A line with its **bold** runs drawn bold.
function Rich({ text, style }: { text: string; style?: Style | Style[] }) {
  return (
    <Text style={style}>
      {splitBold(text).map((run, n) =>
        run.bold ? (
          <Text key={n} style={s.bold}>
            {run.text}
          </Text>
        ) : (
          run.text
        )
      )}
    </Text>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={s.item} wrap={false}>
      <View style={s.bullet} />
      <Rich text={text} style={s.itemText} />
    </View>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// CONNECTING THE TEAM TO THE VISION (Jason, 2026-11-02). The same on
// every vision, after the closing line: how the owner takes it to the
// team. Fixed text, never written by the agent.
export const TEAM_STEPS: ReadonlyArray<{ step: string; questions?: readonly string[] }> = [
  { step: "Bring your team together and read your Vivid Vision." },
  {
    step: "Ask them these questions:",
    questions: [
      "What ideas energized you most?",
      "What other ideas were emerging that you would also love to see?",
      "What questions come to mind?",
    ],
  },
  { step: "Give them some time to reflect individually, then ask them to share." },
  { step: "Tell them you'll incorporate their feedback into the Vision and reshare it with them." },
];

function TeamSection() {
  return (
    <View style={[s.card, { marginTop: 22, paddingBottom: 16 }]} wrap={false}>
      <Text style={s.eyebrow}>Next Steps</Text>
      <Text style={s.h2}>Connecting the Team to the Vision</Text>
      {TEAM_STEPS.map((t, n) => (
        <View key={n} style={[s.theme, { marginBottom: n === TEAM_STEPS.length - 1 ? 0 : 10 }]}>
          <View style={s.themeNum}>
            <Text style={s.themeNumText}>{n + 1}</Text>
          </View>
          <View style={{ flex: 1, paddingTop: 2 }}>
            <Text style={[s.p, { marginBottom: t.questions ? 5 : 0 }]}>{t.step}</Text>
            {t.questions?.map((q, m) => (
              <View key={m} style={s.item}>
                <View style={s.bullet} />
                <Text style={[s.itemText, s.bold]}>{q}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export function VividVisionPdf({ doc, companyName, year }: { doc: VividVisionDoc; companyName: string; year: number }) {
  registerFonts();
  const footerName = `${companyName} · Vivid Vision ${year}`;
  const hasStory = doc.intro.length > 0 || doc.story.length > 0;
  return (
    <Document title={`${doc.title} · ${footerName}`} author={companyName} creator="AiMS-HQ" producer="AiMS-HQ">
      <Page size="LETTER" style={s.page}>
        <View style={s.band}>
          <Text style={s.bandEyebrow}>
            {companyName} {"·"} Vivid Vision {year}
          </Text>
          <Text style={s.title}>{doc.title}</Text>
          {doc.tagline ? <Text style={s.tagline}>{doc.tagline}</Text> : null}
        </View>

        {hasStory ? (
          <View style={{ marginTop: 26 }}>
            <Text style={s.eyebrow}>The Story</Text>
            {doc.intro.map((p, n) => (
              <Rich key={n} text={p} style={s.p} />
            ))}
            {doc.story.map((sec, n) => (
              <View key={n}>
                <View style={s.storyHead} minPresenceAhead={60}>
                  <Text style={s.storyNum}>{pad2(n + 1)}</Text>
                  <Text style={s.storyHeadline}>{sec.headline}</Text>
                </View>
                {sec.paragraphs.map((p, m) => (
                  <Rich key={m} text={p} style={s.p} />
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {doc.proof.groups.length ? (
          <View>
            <View style={s.divider} />
            <View minPresenceAhead={120}>
              <Text style={s.eyebrow}>Proof Points</Text>
              <Text style={s.h2}>{doc.proof.heading ?? `What ${year} Looks Like`}</Text>
            </View>
            {doc.proof.groups.map((g, n) => (
              <View key={n} style={s.group} wrap={false}>
                {g.name ? <Text style={s.groupName}>{g.name}</Text> : null}
                {g.items.map((item, m) => (
                  <Bullet key={m} text={item} />
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {doc.protect.items.length ? (
          <View style={[s.card, { marginTop: doc.proof.groups.length ? 10 : 22 }]} wrap={false}>
            <Text style={s.eyebrow}>What We Protect</Text>
            <Text style={[s.h2, { marginBottom: 6 }]}>{doc.protect.heading ?? "What Never Changes"}</Text>
            {doc.protect.items.map((item, n) => (
              <Rich key={n} text={item} style={n === 0 ? s.protectRow : [s.protectRow, s.protectRule]} />
            ))}
          </View>
        ) : null}

        {doc.themes.items.length ? (
          <View>
            <View minPresenceAhead={120}>
              <Text style={s.eyebrow}>Strategic Focus Themes</Text>
              <Text style={s.h2}>{doc.themes.heading ?? "Where We Put Our Energy"}</Text>
            </View>
            {doc.themes.items.map((t, n) => (
              <View key={n} style={s.theme} wrap={false}>
                <View style={s.themeNum}>
                  <Text style={s.themeNumText}>{n + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.themeName}>{t.name}</Text>
                  {t.subtitle ? <Text style={s.themeSubtitle}>{t.subtitle}</Text> : null}
                  {t.body.map((b, m) => (
                    <Rich key={m} text={b} style={[s.p, { marginBottom: 3 }]} />
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {doc.closing.length ? (
          <View wrap={false}>
            <View style={[s.divider, { marginTop: 6 }]} />
            {doc.closing.map((c, n) => (
              <Rich key={n} text={c} style={s.closing} />
            ))}
          </View>
        ) : null}

        <TeamSection />

        <View style={s.footer} fixed>
          <Text render={({ pageNumber }) => (pageNumber > 1 ? footerName : "")} />
          <Text render={({ pageNumber }) => String(pageNumber)} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderVividVisionPdf(doc: VividVisionDoc, companyName: string, year: number): Promise<Buffer> {
  return renderToBuffer(<VividVisionPdf doc={doc} companyName={companyName} year={year} />);
}

// The file name it downloads as: "Acme Vivid Vision 2036.pdf".
export function vividVisionFileName(companyName: string, year: number): string {
  return `${companyName} Vivid Vision ${year}.pdf`;
}
