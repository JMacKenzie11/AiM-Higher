import path from "node:path";
import { Circle, Defs, Document, Font, Image, Line, LinearGradient, Page, Rect, Stop, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { formatHours } from "../hours-back";
import { MAP, layoutMap, xFor, yFor } from "../map-layout";
import { hoursBackSentence, joinWishes, percent, PRIVACY_LINE, type ReadoutData } from "../readout";
import { READOUT_SECTIONS, type ReadoutSection } from "../types";

// THE CAPACITY DIAGNOSTIC READOUT, AS A PDF. The owner receives this and
// nothing else. AiMS Institute branding as the meeting analysis PDF
// carries it (lib/lead-analysis/pdf): the same brand gradient cover, the
// white and navy logos, Inter and Figtree, the same colours. Rendered on
// request from the published readout (or the draft before publishing),
// never stored.

const ASSETS = path.join(process.cwd(), "src", "lib", "lead-analysis", "pdf", "assets");

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: "Inter",
    fonts: [400, 600, 700, 800].map((w) => ({ src: path.join(ASSETS, `Inter-${w}.ttf`), fontWeight: w })),
  });
  Font.register({
    family: "Figtree",
    fonts: [400, 600, 700].map((w) => ({ src: path.join(ASSETS, `Figtree-${w}.ttf`), fontWeight: w })),
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

const C = {
  navy: "#1F3352",
  navyMid: "#2A4478",
  cobalt: "#3551A4",
  sky: "#8CC4DF",
  chartreuse: "#D6E264",
  midnight: "#11151A",
  sand: "#F7F7F2",
  white: "#FFFFFF",
  navyTint: "#E9ECF1",
  chartreuseTint: "#F5F8DC",
  muted: "#5B6472",
  faint: "#606A77",
  border: "#E2E4DE",
};

const s = StyleSheet.create({
  page: { backgroundColor: C.white, paddingTop: 72, paddingBottom: 64, paddingHorizontal: 54, fontFamily: "Figtree", fontSize: 10.5, color: C.midnight },
  content: { lineHeight: "16.3pt" },
  // Pinned pieces, each with a fixed size (see LeadReport.tsx on why a
  // fixed row of children breaks long documents).
  headerLogo: { position: "absolute", top: 20, left: 54, width: 30, height: 30 },
  headerText: { position: "absolute", top: 31, right: 54, width: 420, height: 10, textAlign: "right", fontFamily: "Inter", fontSize: 8, fontWeight: 700, letterSpacing: 1.4, color: C.muted, textTransform: "uppercase" },
  headerRule: { position: "absolute", top: 56, left: 54, right: 54, height: 1, backgroundColor: C.border },
  footerText: { position: "absolute", bottom: 24, height: 10, fontFamily: "Inter", fontSize: 8, color: C.faint },
  h2: { fontFamily: "Inter", fontSize: 14, fontWeight: 700, color: C.navy, marginTop: 16, marginBottom: 6 },
  lead: { fontFamily: "Figtree", fontSize: 11, color: C.navy, marginBottom: 8 },
  p: { marginBottom: 6 },
  muted: { color: C.muted },
  small: { fontSize: 9.5 },
  bold: { fontWeight: 700 },
  cardSand: { borderRadius: 8, padding: 10, marginBottom: 6, backgroundColor: C.sand },
  label: { fontFamily: "Inter", fontSize: 7.5, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", color: C.muted },
  figValue: { fontFamily: "Inter", fontSize: 18, fontWeight: 800, color: C.navy, marginTop: 2 },
  row: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.border },
});

function PageFrame({ r, section, children }: { r: ReadoutData; section: string; children: React.ReactNode }) {
  return (
    <Page size="LETTER" style={s.page}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- a react-pdf Image, not an <img>: it has no alt prop */}
      <Image src={path.join(ASSETS, "logo-navy.png")} style={s.headerLogo} fixed />
      <Text style={s.headerText} fixed>
        {section} {"·"} {r.clientName}
      </Text>
      <View style={s.headerRule} fixed />
      <View style={s.content}>{children}</View>
      <Text style={[s.footerText, { left: 54, width: 330 }]} fixed>
        Capacity Diagnostic readout, {r.clientName}
      </Text>
      <Text
        style={[s.footerText, { right: 54, width: 170, height: undefined, textAlign: "right" }]}
        fixed
        render={({ pageNumber, totalPages }) => `The AiMS Institute · ${pageNumber} of ${totalPages}`}
      />
    </Page>
  );
}

const titleOf = (k: ReadoutSection) => READOUT_SECTIONS.find((x) => x.key === k)!.title;

// together: the whole section moves to the next page rather than split,
// for the short sections whose heading, paragraph and figures read as
// one (the map, Hours Back).
function Section({ k, r, together = false, children }: { k: ReadoutSection; r: ReadoutData; together?: boolean; children?: React.ReactNode }) {
  return (
    <View wrap={!together}>
      <Text style={s.h2} minPresenceAhead={80}>
        {titleOf(k)}
      </Text>
      {r.narrative[k] ? <Text style={s.lead}>{r.narrative[k]}</Text> : null}
      {children}
    </View>
  );
}

function Figures({ items }: { items: Array<[string, string]> }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }} wrap={false}>
      {items.map(([label, value]) => (
        <View key={label} style={[s.cardSand, { flex: 1, marginBottom: 0 }]}>
          <Text style={s.label}>{label}</Text>
          <Text style={s.figValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <View style={{ marginBottom: 6 }}>
      {rows.map(([left, right], i) => (
        <View key={i} style={s.row} wrap={false}>
          <Text style={{ flex: 1, paddingRight: 8, color: C.navy, fontWeight: 600 }}>{left}</Text>
          <Text style={[s.muted, { width: 190, textAlign: "right" }]}>{right}</Text>
        </View>
      ))}
    </View>
  );
}

// The Capacity Map, drawn from the same layout as the page's SVG.
function MapPdf({ r }: { r: ReadoutData }) {
  const dots = layoutMap(r.map.points);
  const x0 = xFor(0.5), x25 = xFor(2.5), x55 = xFor(5.5);
  const y0 = yFor(0.5), y25 = yFor(2.5), y55 = yFor(5.5);
  const width = 504;
  const height = (width * MAP.height) / MAP.width;
  return (
    <View style={{ marginBottom: 8 }}>
      <Svg viewBox={`0 0 ${MAP.width} ${MAP.height}`} style={{ width, height }}>
        <Rect x={x0} y={y25} width={x25 - x0} height={y0 - y25} fill={C.chartreuseTint} />
        <Rect x={x0} y={y55} width={x55 - x0} height={y0 - y55} fill="none" stroke={C.border} strokeWidth={1} />
        <Line x1={xFor(3)} x2={xFor(3)} y1={y55} y2={y0} stroke={C.border} strokeWidth={1} strokeDasharray="4 4" />
        <Line x1={x0} x2={x55} y1={yFor(3)} y2={yFor(3)} stroke={C.border} strokeWidth={1} strokeDasharray="4 4" />
        {dots.map((d) => (
          <Circle
            key={d.taskId}
            cx={d.cx}
            cy={d.cy}
            r={d.r}
            fill={d.checked ? C.cobalt : C.white}
            fillOpacity={d.checked ? 0.75 : 1}
            stroke={C.cobalt}
            strokeWidth={1.5}
          />
        ))}
      </Svg>
      <View style={{ flexDirection: "row", justifyContent: "space-between", width, marginTop: 2 }}>
        <Text style={[s.small, s.muted]}>Left: drains me. Right: energizes me.</Text>
        <Text style={[s.small, s.muted]}>Bottom: routine. Top: needs experience.</Text>
      </View>
      <Text style={[s.small, s.muted]}>
        Each dot is one task, sized by hours a week. Filled dots are volume-checked; hollow dots are estimates. The shaded corner is draining, routine work.
      </Text>
    </View>
  );
}

export function ReadoutPdf({ r }: { r: ReadoutData }) {
  registerFonts();
  const h = r.hoursBack;
  const [y, m, d] = r.preparedOn.split("-").map(Number);
  const dated = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <Document
      title={`Capacity Diagnostic Readout: ${r.clientName}`}
      author="The AiMS Institute"
      subject={`Prepared for ${r.ownerName ?? r.clientName}`}
      creator="The AiMS Institute"
      producer="The AiMS Institute"
    >
      {/* ---- Cover ---- */}
      <Page size="LETTER" style={{ backgroundColor: C.navy, fontFamily: "Inter", color: C.white }}>
        <Svg viewBox="0 0 612 792" style={{ position: "absolute", top: 0, left: 0, width: 612, height: 792 }}>
          <Defs>
            <LinearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor={C.navy} />
              <Stop offset="55%" stopColor={C.navyMid} />
              <Stop offset="100%" stopColor={C.cobalt} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="612" height="792" fill="url(#brand)" />
        </Svg>
        <View style={{ padding: 60, flex: 1, justifyContent: "space-between" }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- a react-pdf Image, not an <img>: it has no alt prop */}
          <Image src={path.join(ASSETS, "logo-white.png")} style={{ width: 120, height: 120, marginLeft: -6 }} />
          <View>
            <Text style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.2, textTransform: "uppercase", color: C.sky, marginBottom: 14 }}>
              The AiMS Institute
            </Text>
            <Text style={{ fontSize: 40, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1.12 }}>Capacity Diagnostic Readout</Text>
            <View style={{ width: 90, height: 4, borderRadius: 2, backgroundColor: C.chartreuse, marginTop: 18, marginBottom: 22 }} />
            <Text style={{ fontFamily: "Figtree", fontSize: 15, fontWeight: 600 }}>
              Prepared for {r.ownerName ? `${r.ownerName}, ` : ""}
              {r.clientName}
            </Text>
            <Text style={{ fontFamily: "Figtree", fontSize: 11, color: C.sky, marginTop: 6 }}>{dated}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 12 }}>
            {(
              [
                ["Measured hours back a week", formatHours(h.measured)],
                ["Projected hours back a week", formatHours(h.projected)],
              ] as const
            ).map(([label, value]) => (
              <View
                key={label}
                style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, width: 200 }}
              >
                <Text style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1.6, textTransform: "uppercase", color: C.sky }}>{label}</Text>
                <Text style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1, marginTop: 4 }}>{value}</Text>
              </View>
            ))}
          </View>
        </View>
      </Page>

      {/* ---- The readout ---- */}
      <PageFrame r={r} section="Readout">
        <View style={[s.cardSand, { borderLeftWidth: 3, borderLeftColor: C.chartreuse }]}>
          <Text style={s.small}>{PRIVACY_LINE}</Text>
        </View>

        <Section k="in_their_words" r={r}>
          {r.quotes.length === 0 ? (
            <Text style={s.muted}>No lines approved yet.</Text>
          ) : (
            r.quotes.map((q, i) => (
              <View key={i} style={[s.cardSand, { borderLeftWidth: 3, borderLeftColor: C.chartreuse }]} wrap={false}>
                <Text style={{ fontWeight: 600, color: C.navy }}>{q.text}</Text>
                {q.name ? <Text style={[s.muted, s.small]}>{q.name}</Text> : null}
              </View>
            ))
          )}
        </Section>

        <Section k="first_win" r={r}>
          {r.firstWin ? (
            <>
              <Text style={s.p}>
                <Text style={s.bold}>{r.firstWin.title}</Text>, a {r.firstWin.pattern.toLowerCase()} for {r.firstWin.serves.toLowerCase() || "the team"} ({r.firstWin.role}).
              </Text>
              <Figures
                items={[
                  ["Minutes per unit before", formatHours(r.firstWin.baselineMinutes)],
                  ["Minutes per unit after", formatHours(r.firstWin.afterMinutes)],
                  ["Units a week", formatHours(r.firstWin.unitsPerWeek)],
                  ["Hours back, measured", formatHours(r.firstWin.measured)],
                ]}
              />
            </>
          ) : (
            <Text style={s.muted}>The first win has not been chosen yet.</Text>
          )}
        </Section>

        <Section k="capacity_map" r={r} together>
          <MapPdf r={r} />
          <Figures
            items={[
              ["Tasks mapped", String(r.map.tasks)],
              ["Draining and routine", String(r.map.candidates)],
              ["Hours a week", formatHours(r.map.totalHours)],
              ["Draining and routine hours", formatHours(r.map.candidateHours)],
              ["Volume-checked", formatHours(r.map.checkedHours)],
            ]}
          />
        </Section>

        <Section k="hours_back" r={r} together>
          <Figures
            items={[
              ["Measured", formatHours(h.measured)],
              ["Projected", formatHours(h.projected)],
              ["Recovery rate", percent(h.recoveryRate)],
              [`Guarantee, ${formatHours(h.guaranteeHours)} hours`, h.guaranteeMet == null ? "Not yet" : h.guaranteeMet ? "Met" : "Not met"],
            ]}
          />
          <Text style={[s.muted, s.small]}>{hoursBackSentence(h)}</Text>
        </Section>

        <Section k="destination" r={r}>
          <Text style={s.p}>{r.destination.text?.trim() || "Not named yet."}</Text>
          {r.destination.roles.length ? (
            <Rows rows={r.destination.roles.map((role) => [`${role.role}${role.wishes.length ? `: ${joinWishes(role.wishes)}` : ""}`, `${formatHours(role.hours)} hours a week`])} />
          ) : null}
        </Section>

        <Section k="next_wins" r={r}>
          {r.nextWins.length === 0 ? (
            <Text style={s.muted}>None yet.</Text>
          ) : (
            <Rows
              rows={r.nextWins.map((w, i) => [
                `${i + 1}. ${w.title}, helps ${w.helps.join(", ") || "the team"}`,
                `${formatHours(w.hours)} h a week, risk ${w.dataRisk ?? "not set"}, build ${w.buildEffortHours == null ? "not estimated" : `${formatHours(w.buildEffortHours)} h`}`,
              ])}
            />
          )}
        </Section>

        <Section k="guardrails" r={r}>
          <Text style={s.p}>
            <Text style={s.bold}>
              {r.guardrails.tools.length} {r.guardrails.tools.length === 1 ? "tool" : "tools"} in use
            </Text>
            {r.guardrails.tools.length ? `: ${r.guardrails.tools.join(", ")}` : ""}
          </Text>
          {r.guardrails.dataAtRisk ? (
            <Text style={s.p}>
              <Text style={s.bold}>Data at risk: </Text>
              {r.guardrails.dataAtRisk}
            </Text>
          ) : null}
          {r.guardrails.rules.map((rule, i) => (
            <Text key={i} style={s.p}>
              {i + 1}. {rule}
            </Text>
          ))}
        </Section>

        <Section k="roadmap" r={r}>
          {r.roadmap.length === 0 ? (
            <Text style={s.muted}>Not set yet.</Text>
          ) : (
            <Rows
              rows={r.roadmap.map((item, i) => [
                `${i + 1}. ${item.title}${item.champion ? `, champion: ${item.champion}` : ""}`,
                item.target_week ? `Week ${item.target_week}` : "Week not set",
              ])}
            />
          )}
        </Section>
      </PageFrame>
    </Document>
  );
}
